import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LobbyQuery } from '../../src/network/lobby-query.js';
import { ControlledPeer, unavailable, welcome } from '../support/discovery-peer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('disposable lobby queries', () => {
  it('installs the session consumer before a following data event can arrive', async () => {
    const peer = new ControlledPeer(),
      session = vi.fn();
    const query = new LobbyQuery(
      peer,
      ['a', 'b'],
      {},
      {
        mode: 'first',
        timeout: 1000,
        gather: 0,
        adopt: (offer) => {
          offer.connection.on('data', session);
        },
      },
    );
    const result = query.run();
    peer.connections.get('a')!.emit('data', welcome());
    peer.connections.get('a')!.emit('data', { t: 'lobby', d: 'next packet' });
    await result;
    expect(session).toHaveBeenCalledWith({ t: 'lobby', d: 'next packet' });
    expect(peer.connections.get('a')!.close).not.toHaveBeenCalled();
    expect(peer.connections.get('b')!.close).toHaveBeenCalledOnce();
    expect(peer.listenerCount('error')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('selects the fuller valid offer and closes other connections', async () => {
    const peer = new ControlledPeer(),
      adopt = vi.fn();
    const result = new LobbyQuery(
      peer,
      ['a', 'b', 'c'],
      {},
      { mode: 'best', timeout: 11000, gather: 1500, adopt },
    ).run();
    peer.connections.get('a')!.emit('data', welcome(2));
    peer.connections.get('b')!.emit('data', { t: 'refused', d: { reason: 'full' } });
    peer.connections.get('c')!.emit('data', welcome(5));
    await result;
    expect(adopt.mock.calls[0][0].hostId).toBe('c');
    expect(peer.connections.get('c')!.close).not.toHaveBeenCalled();
    expect(peer.connections.get('a')!.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('can adopt a late offer when the overall deadline precedes the gathering deadline', async () => {
    const peer = new ControlledPeer(),
      adopt = vi.fn();
    const result = new LobbyQuery(
      peer,
      ['a', 'b'],
      {},
      { mode: 'best', timeout: 11000, gather: 1500, adopt },
    ).run();
    await vi.advanceTimersByTimeAsync(10500);
    peer.connections.get('a')!.emit('data', welcome());
    await vi.advanceTimersByTimeAsync(500);
    await result;
    expect(adopt).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects cancellation, releases listeners/connections and prevents query reuse', async () => {
    const peer = new ControlledPeer(),
      controller = new AbortController();
    const query = new LobbyQuery(
      peer,
      ['a'],
      {},
      { mode: 'first', timeout: 1000, gather: 0, signal: controller.signal, adopt: vi.fn() },
    );
    const result = expect(query.run()).rejects.toThrow('cancelled');
    await expect(query.run()).rejects.toThrow('single-use');
    controller.abort();
    await result;
    expect(peer.connections.get('a')!.close).toHaveBeenCalledOnce();
    expect(peer.connections.get('a')!.listenerCount('data')).toBe(0);
    expect(peer.listenerCount('error')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not adopt a malformed or closed offer', async () => {
    const peer = new ControlledPeer(),
      adopt = vi.fn();
    const result = expect(
      new LobbyQuery(
        peer,
        ['a', 'b'],
        {},
        { mode: 'best', timeout: 1000, gather: 100, adopt },
      ).run(),
    ).rejects.toMatchObject({ reason: 'timeout' });
    peer.connections.get('a')!.emit('data', { t: 'welcome', d: null });
    peer.connections.get('a')!.emit('data', welcome());
    peer.connections.get('a')!.close();
    peer.connections.get('b')!.emit('data', { t: 'refused', d: { reason: 'closed' } });
    await result;
    expect(adopt).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps a full lobby snapshot after its probe closes while another slot is pending', async () => {
    const peer = new ControlledPeer();
    const result = new LobbyQuery(
      peer,
      ['a', 'b'],
      {},
      {
        mode: 'all',
        timeout: 11000,
        gather: 2200,
      },
    ).run();
    peer.connections.get('a')!.emit('data', {
      t: 'refused',
      d: { reason: 'full', players: 10, max: 10 },
    });
    peer.connections.get('a')!.close();
    unavailable(peer, 'b');
    expect(await result).toMatchObject([
      { hostId: 'a', kind: 'refused', details: { players: 10, max: 10 } },
    ]);
  });
  it('starts public probes in batches and waits for a later alias before selecting an offer', async () => {
    const peer = new ControlledPeer();
    const adopt = vi.fn();
    const ids = Array.from({ length: 17 }, (_, i) => `slot-${i}`);
    const query = new LobbyQuery(
      peer,
      ids,
      {},
      {
        mode: 'best',
        timeout: 11000,
        gather: 100,
        adopt,
      },
    );
    const result = query.run();
    expect(peer.connect).toHaveBeenCalledTimes(16);
    expect(query.diagnostics.queued).toBe(1);
    peer.connections.get(ids[0])!.emit('data', welcome(1));
    for (const id of ids.slice(1, 16)) unavailable(peer, id);
    expect(peer.connections.get(ids[1])!.close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(749);
    expect(adopt).not.toHaveBeenCalled();
    expect(peer.connections.has(ids[16])).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(query.diagnostics.queued).toBe(0);
    const last = peer.connections.get(ids[16])!;
    last.emit('data', welcome(4));
    await result;
    expect(adopt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ connection: last }));
    expect(last.close).not.toHaveBeenCalled();
    expect(peer.connections.get(ids[1])!.close).toHaveBeenCalledOnce();
  });

  it('resumes the last scheduled probe when signaling reopens before the deadline', async () => {
    const peer = Object.assign(new ControlledPeer(), { disconnected: false, reconnect: vi.fn() });
    const ids = Array.from({ length: 17 }, (_, i) => `slot-${i}`);
    const query = new LobbyQuery(peer, ids, {}, { mode: 'all', timeout: 11000, gather: 2200 });
    const result = query.run();
    for (const id of ids.slice(0, 16)) unavailable(peer, id);
    peer.disconnected = true;
    await vi.advanceTimersByTimeAsync(750);
    expect(peer.reconnect).toHaveBeenCalledOnce();
    expect(query.diagnostics.queued).toBe(1);
    peer.disconnected = false;
    peer.emit('open');
    peer.connections.get(ids[16])!.emit('data', welcome());
    expect(await result).toMatchObject([{ hostId: ids[16] }]);
    expect(query.incomplete).toBe(false);
    expect(query.diagnostics.signalingReconnects).toBe(1);
    expect(peer.listenerCount('open')).toBe(0);
  });

  it('reports an incomplete search if signaling fails to reopen before the original deadline', async () => {
    const peer = Object.assign(new ControlledPeer(), { disconnected: false, reconnect: vi.fn() });
    const ids = Array.from({ length: 17 }, (_, i) => `slot-${i}`);
    const adopt = vi.fn();
    const query = new LobbyQuery(
      peer,
      ids,
      {},
      { mode: 'best', timeout: 11000, gather: 1500, adopt },
    );
    const result = expect(query.run()).rejects.toMatchObject({ reason: 'timeout' });
    peer.connections.get(ids[0])!.emit('data', welcome());
    for (const id of ids.slice(1, 16)) unavailable(peer, id);
    peer.disconnected = true;
    await vi.advanceTimersByTimeAsync(11000);
    await result;
    expect(peer.reconnect).toHaveBeenCalledOnce();
    expect(adopt).not.toHaveBeenCalled();
    expect(query.diagnostics).toMatchObject({ pending: 1, queued: 1, signalingReconnects: 1 });
    expect(peer.listenerCount('open')).toBe(0);
  });

  it('cancels scheduled public batches together with the active probes', async () => {
    const peer = new ControlledPeer();
    const controller = new AbortController();
    const ids = Array.from({ length: 17 }, (_, i) => `slot-${i}`);
    const result = expect(
      new LobbyQuery(
        peer,
        ids,
        {},
        {
          mode: 'all',
          timeout: 11000,
          gather: 2200,
          signal: controller.signal,
        },
      ).run(),
    ).rejects.toMatchObject({ reason: 'cancelled' });
    controller.abort();
    await result;
    await vi.advanceTimersByTimeAsync(11000);
    expect(peer.connect).toHaveBeenCalledTimes(16);
    expect([...peer.connections.values()].every((connection) => !connection.open)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('finishes unavailable peers immediately and unanswered peers at the deadline', async () => {
    const peer = new ControlledPeer();
    const failed = expect(
      new LobbyQuery(
        peer,
        ['a'],
        {},
        { mode: 'first', timeout: 1000, gather: 0, adopt: vi.fn() },
      ).run(),
    ).rejects.toThrow('no lobby');
    unavailable(peer, 'a');
    await failed;
    const timed = expect(
      new LobbyQuery(
        peer,
        ['b'],
        {},
        { mode: 'first', timeout: 1000, gather: 0, adopt: vi.fn() },
      ).run(),
    ).rejects.toThrow('no answer');
    await vi.advanceTimersByTimeAsync(1000);
    await timed;
    expect(peer.listenerCount('error')).toBe(0);
    peer.connect.mockReturnValue(undefined);
    await expect(
      new LobbyQuery(
        peer,
        ['disconnected'],
        {},
        {
          mode: 'first',
          timeout: 1000,
          gather: 0,
          adopt: vi.fn(),
        },
      ).run(),
    ).rejects.toThrow('no lobby');
    expect(vi.getTimerCount()).toBe(0);
  });
});
