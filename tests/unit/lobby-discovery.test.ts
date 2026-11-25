import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LobbyDiscovery } from '../../src/network/lobby-discovery.js';
import { ControlledPeer, unavailable, welcome } from '../support/discovery-peer';
import { flushMessages } from '../support/peer-network';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('discovery peer ownership', () => {
  it('destroys an endpoint whose factory resolves after cancellation', async () => {
    let release!: (peer: ControlledPeer) => void;
    const discovery = new LobbyDiscovery(
      () =>
        new Promise<ControlledPeer>((resolve) => {
          release = resolve;
        }),
      'test-',
    );
    const request = expect(discovery.browse({})).rejects.toThrow('cancelled');
    discovery.cancel();
    const peer = new ControlledPeer();
    release(peer);
    await request;
    expect(peer.destroy).toHaveBeenCalledOnce();
    expect(peer.connect).not.toHaveBeenCalled();
  });
  it('destroys browse endpoints but transfers selected quick-join endpoints explicitly', async () => {
    const browsePeer = new ControlledPeer();
    const browser = new LobbyDiscovery(async () => browsePeer, 'test-');
    const browsing = browser.browse({ name: 'paper' });
    await flushMessages();
    browsePeer.connections.get('test-PUB0')!.emit('data', welcome(3));
    for (const id of browsePeer.connections.keys())
      if (id !== 'test-PUB0') unavailable(browsePeer, id);
    expect(await browsing).toMatchObject({
      rows: [{ code: 'PUB0', players: 3, full: false }],
      incomplete: false,
    });
    expect(browsePeer.destroy).toHaveBeenCalledOnce();
    expect([...browsePeer.connections.values()].every((connection) => !connection.open)).toBe(true);
    const peer = new ControlledPeer(),
      adopted = vi.fn();
    const joining = new LobbyDiscovery(async () => peer, 'test-').join({}, adopted);
    await flushMessages();
    peer.connections.get('test-PUB0')!.emit('data', welcome());
    for (const id of peer.connections.keys()) if (id !== 'test-PUB0') unavailable(peer, id);
    await joining;
    expect(adopted.mock.calls[0][0]).toBe(peer);
    expect(peer.destroy).not.toHaveBeenCalled();
    expect(peer.connections.get('test-PUB0')!.send).toHaveBeenCalledWith({ t: 'stay' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans up the endpoint when a session refuses adoption', async () => {
    const peer = new ControlledPeer();
    const discovery = new LobbyDiscovery(async () => peer, 'test-');
    const joining = expect(
      discovery.join({}, () => {
        throw new Error('consumer failed');
      }),
    ).rejects.toThrow('consumer failed');
    await flushMessages();
    peer.connections.get('test-PUB0')!.emit('data', welcome());
    for (const id of peer.connections.keys()) if (id !== 'test-PUB0') unavailable(peer, id);
    await joining;
    expect(peer.destroy).toHaveBeenCalledOnce();
    expect([...peer.connections.values()].every((connection) => !connection.open)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases a browse operation if its status consumer throws', async () => {
    const peer = new ControlledPeer();
    const discovery = new LobbyDiscovery(async () => peer, 'test-');
    const browsing = expect(
      discovery.browse({}, () => {
        throw new Error('status consumer failed');
      }),
    ).rejects.toThrow('status consumer failed');
    await flushMessages();
    peer.connections.get('test-PUB0')!.emit('data', welcome());
    await browsing;
    expect(peer.destroy).toHaveBeenCalledOnce();
    expect([...peer.connections.values()].every((connection) => !connection.open)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reports answered, unavailable and pending probes separately without exposing host IDs', async () => {
    const peer = new ControlledPeer();
    const discovery = new LobbyDiscovery(async () => peer, 'test-');
    const browsing = discovery.browse({});
    await flushMessages();
    peer.connections.get('test-PUB0')!.emit('data', welcome());
    for (const [id, connection] of peer.connections) {
      if (id === 'test-PUB0') continue;
      connection.open = false;
      if (id !== 'test-PUB1') unavailable(peer, id);
    }
    await vi.advanceTimersByTimeAsync(2200);
    expect(await browsing).toMatchObject({ rows: [{ code: 'PUB0' }], incomplete: true });
    expect(discovery.diagnostics).toMatchObject({
      signaling: 'ready',
      probes: { slots: 64, unavailable: 62, pending: 1, welcomed: 1, refused: 0 },
    });
    expect(JSON.stringify(discovery.diagnostics)).not.toContain('PUB');
  });

  it('only reports a completed empty search when all slots answer or are explicitly unavailable', async () => {
    const peer = new ControlledPeer();
    const discovery = new LobbyDiscovery(async () => peer, 'test-');
    const adopt = vi.fn();
    const joining = expect(discovery.join({}, adopt)).rejects.toMatchObject({ reason: 'timeout' });
    await flushMessages();
    for (const id of peer.connections.keys()) if (id !== 'test-PUB1') unavailable(peer, id);
    await vi.advanceTimersByTimeAsync(11000);
    await joining;
    expect(adopt).not.toHaveBeenCalled();
  });
});
