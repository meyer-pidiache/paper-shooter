import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Net, makeCode } from '../../src/network/peer-transport.js';
import { isWireMessage } from '../../src/network/protocol.js';
import { RejoinCredentials } from '../../src/network/rejoin-credentials.js';
import { flushMessages, peerNetwork } from '../support/peer-network.js';

const clients = [];
afterEach(() => {
  for (const client of clients) client.leave();
  clients.length = 0;
  vi.useRealTimers();
});
function setup() {
  const network = peerNetwork();
  const client = () => {
    // Isolate generic routing behavior from the gameplay validators tested through composed sessions.
    const net = new Net({
      PeerClass: network.Peer,
      options: async () => ({}),
      namespace: 'test-',
      validatePayload: () => true,
    });
    clients.push(net);
    return net;
  };
  return { ...network, client };
}

describe('PeerJS lobby transport', () => {
  it('accepts credentials only from the host and withholds them from a replacement lobby', async () => {
    const { Peer } = setup();
    const make = (rejoinCredentials = new RejoinCredentials(null)) => {
      const net = new Net({
        PeerClass: Peer,
        options: async () => ({}),
        namespace: 'rejoin-',
        rejoinCredentials,
      });
      clients.push(net);
      return net;
    };
    const host = make();
    const guest = make();
    const other = make();
    const code = 'PUB0';
    await host.host({ code, isPublic: true });
    await guest.join(code);
    await other.join(code);
    const credential = { key: host.rejoinKey, token: 'a'.repeat(32) };
    host.sendTo(guest.id, 'rejoin-token', credential);
    other.broadcast('rejoin-token', { ...credential, token: 'b'.repeat(32) });
    await flushMessages();
    expect(guest.rejoinCredentials.get(code)).toMatchObject(credential);
    expect(other.rejoinCredentials.get(code)).toBeUndefined();

    guest.leave();
    host.leave();
    const newHost = make();
    await newHost.host({ code, isPublic: true });
    newHost.onPeerResume = vi.fn();
    await guest.join(code);
    expect(newHost.onPeerResume).not.toHaveBeenCalled();
    expect(guest.active).toBe(true);
  });

  it('recovers a full public lobby on the canonical channel after joining through an alias', async () => {
    vi.useFakeTimers();
    const { Peer } = setup();
    const credentials = new RejoinCredentials(null);
    const make = (rejoinCredentials = new RejoinCredentials(null)) => {
      const net = new Net({
        PeerClass: Peer,
        options: async () => ({}),
        namespace: 'rejoin-',
        rejoinCredentials,
      });
      clients.push(net);
      return net;
    };
    const host = make();
    const guest = make(credentials);
    const outsider = make(new RejoinCredentials(null));
    await host.host({ code: 'PUB0-1', isPublic: true });
    host.claimAlias('PUB0');
    await vi.advanceTimersByTimeAsync(1500);
    await guest.join('PUB0');
    expect(guest.hostId).toBe('rejoin-PUB0');
    expect(guest.authorityId).toBe(host.id);
    const previous = guest.id;
    const token = 'a'.repeat(32);
    host.sendTo(previous, 'rejoin-token', { key: host.rejoinKey, token });
    await flushMessages();
    host.maxPlayers = 2;
    host.onPeerResume = vi.fn((value) => (value === token ? previous : undefined));

    outsider.rejoinCredentials.save('PUB0', {
      hostId: host.id,
      key: host.rejoinKey,
      token: 'b'.repeat(32),
    });
    // The rejected recovery must enter discovery before its fake timeout is advanced.
    let startDiscovery;
    const discoveryStarted = new Promise((resolve) => (startDiscovery = resolve));
    const noOpenLobby = expect(
      outsider.quickJoin({}, (status) => {
        if (status === 'looking for an open lobby…') startDiscovery();
      }),
    ).rejects.toThrow('no open public');
    await discoveryStarted;
    await vi.advanceTimersByTimeAsync(2300);
    await noOpenLobby;
    expect(host.peerIds).toEqual([previous]);

    const reloaded = make(credentials);
    await reloaded.quickJoin();
    expect(host.onPeerResume).toHaveBeenLastCalledWith(token);
    expect(reloaded.hostId).toBe(host.id);
    expect(host.peerIds).toEqual([reloaded.id]);
  });

  it('drops malformed payloads before dispatch or forwarding to another peer', async () => {
    const { Peer } = setup();
    const make = () => {
      const net = new Net({ PeerClass: Peer, options: async () => ({}), namespace: 'validated-' });
      clients.push(net);
      return net;
    };
    const host = make(),
      a = make(),
      b = make();
    await host.host({ code: 'ABCDE' });
    await a.join('ABCDE');
    await b.join('ABCDE');
    const local = vi.fn(),
      forwarded = vi.fn();
    host.on('pdmg', local);
    b.on('pdmg', forwarded);
    const connection = a.conns.get(host.id);
    for (const d of [null, { amount: -25 }, { amount: 1, from: [0, Infinity, 0] }])
      connection.send({ t: 'pdmg', d, to: b.id, relay: true });
    await flushMessages();
    expect(local).not.toHaveBeenCalled();
    expect(forwarded).not.toHaveBeenCalled();
    a.sendTo(b.id, 'pdmg', { amount: 25 });
    await flushMessages();
    expect(forwarded).toHaveBeenCalledWith({ amount: 25 }, a.id);
  });
  it('accepts canonical host authority when a late join targets its reclaimed alias', async () => {
    vi.useFakeTimers();
    const { client } = setup();
    const host = client(),
      guest = client();
    await host.host({ code: 'ABCDE-1' });
    host.claimAlias('ABCDE');
    await vi.advanceTimersByTimeAsync(1501);
    await guest.join('ABCDE');
    await flushMessages();
    expect(guest.hostId).toBe('test-ABCDE');
    expect(guest.authorityId).toBe(host.id);
    const end = vi.fn();
    guest.onHost('end', end);
    host.send('end', { id: host.id });
    await flushMessages();
    expect(end).toHaveBeenCalledOnce();
  });
  it('cancels a lobby whose configuration resolves after leaving', async () => {
    const { Peer, peers } = peerNetwork();
    let release;
    const options = new Promise((resolve) => {
      release = resolve;
    });
    const net = new Net({ PeerClass: Peer, options: () => options });
    clients.push(net);
    const hosting = net.host({ code: 'ABCDE' });
    net.leave();
    release({});
    await expect(hosting).rejects.toThrow('cancelled');
    expect(peers.size).toBe(0);
  });
  it('hosts, joins, relays, sends direct messages and notifies disconnections', async () => {
    const { client } = setup();
    const host = client(),
      a = client(),
      b = client();
    const joined = vi.fn();
    host.onPeerJoin = joined;
    expect(await host.host({ code: 'abcde' })).toBe('ABCDE');
    await a.join('abcde', { name: 'a' });
    await b.join('ABCDE', { name: 'b' });
    expect(host.peerIds).toHaveLength(2);
    expect(joined).toHaveBeenCalledTimes(2);
    expect(a.active).toBe(true);
    const handler = vi.fn();
    b.on('test', handler);
    a.broadcast('test', { value: 1 });
    await flushMessages();
    expect(handler).toHaveBeenCalledWith({ value: 1 }, a.id);
    a.sendTo(b.id, 'test', { value: 2 });
    await flushMessages();
    expect(handler).toHaveBeenLastCalledWith({ value: 2 }, a.id);
    host.sendTo(b.id, 'test', { value: 3 });
    await flushMessages();
    expect(handler).toHaveBeenLastCalledWith({ value: 3 }, host.id);
    const left = vi.fn();
    host.onPeerLeave = left;
    const oldId = a.id;
    a.leave();
    await flushMessages();
    expect(left).toHaveBeenCalledWith(oldId);
    const disconnected = vi.fn();
    b.onDisconnect = disconnected;
    host.leave();
    await flushMessages();
    expect(disconnected).toHaveBeenCalledOnce();
    expect(b.connected).toBe(false);
  });

  it('measures active peer round trips and clears samples when disabled or disconnected', async () => {
    vi.useFakeTimers();
    const { client } = setup();
    const host = client();
    const guest = client();
    await host.host({ code: 'PING1' });
    await guest.join('PING1');
    host.setNerdStatsEnabled(true);
    guest.setNerdStatsEnabled(true);
    await vi.advanceTimersByTimeAsync(1500);
    await flushMessages();
    expect(host.getNerdPing().label).toBe('PEERS MEDIAN · 1');
    expect(host.getNerdPing().value).not.toBeNull();
    expect(guest.getNerdPing().label).toBe('HOST');
    expect(guest.getNerdPing().value).not.toBeNull();
    host.setNerdStatsEnabled(false);
    expect(host.getNerdPing().value).toBeNull();
    guest.leave();
    expect(host.getNerdPing().label).toBe('PEERS MEDIAN · 0');
  });
  it('answers only valid probes on open channels and ignores unmatched RTT replies', async () => {
    const { client } = setup();
    const host = client();
    const guest = client();
    await host.host({ code: 'PING2' });
    await guest.join('PING2');
    const connection = host.conns.get(guest.id);
    const send = vi.spyOn(connection, 'send');

    host._handleStatsPing(connection, { kind: 'ping', id: 1 });
    expect(send).toHaveBeenCalledWith({ t: 'paper:nerd-stats', kind: 'pong', id: 1 });
    connection.open = false;
    host._handleStatsPing(connection, { kind: 'ping', id: 2 });
    host._handleStatsPing(connection, { kind: 'other', id: 3 });
    host._handleStatsPing(connection, { kind: 'pong', id: 4 });
    host._handleStatsPing(connection, { kind: 'pong', id: Number.MAX_SAFE_INTEGER + 1 });
    expect(send).toHaveBeenCalledOnce();
    expect(host.pingSamples.size).toBe(0);
  });
  it('uses a fresh median across host peers and discards stale RTT samples', async () => {
    const { client } = setup();
    const host = client();
    await host.host({ code: 'MEDIAN' });
    const now = host._now();
    host.pingSamples.set('a', { value: 10, at: now });
    host.pingSamples.set('b', { value: 20, at: now });
    expect(host.getNerdPing()).toEqual({ value: 15, label: 'PEERS MEDIAN · 2' });
    host.pingSamples.set('b', { value: 20, at: now - 6000 });
    expect(host.getNerdPing()).toEqual({ value: 10, label: 'PEERS MEDIAN · 1' });
    host.connected = false;
    expect(host.getNerdPing()).toEqual({ value: null, label: 'PEERS MEDIAN' });
  });

  it('finds public lobbies without joining and lets quick play seat a player', async () => {
    vi.useFakeTimers();
    const { client } = setup();
    const host = client(),
      other = client(),
      guest = client();
    await host.host({ isPublic: true });
    await other.host({ isPublic: true });
    expect([host.code, other.code]).toEqual(['PUB0', 'PUB1']);
    const list = guest.listLobbies();
    await vi.runAllTimersAsync();
    const { rows: lobbies } = await list;
    expect(lobbies.map((lobby) => lobby.code)).toEqual(['PUB0', 'PUB1']);
    expect(host.conns.size).toBe(0);
    const joined = guest.quickJoin({}, vi.fn());
    await vi.runAllTimersAsync();
    expect(await joined).toBe('PUB0');
    await flushMessages();
    expect(host.conns.size).toBe(1);
    await expect(guest.listLobbies()).rejects.toThrow('leave the lobby');
  });

  it('refuses full/closed lobbies and reports unavailable codes', async () => {
    const { client } = setup();
    const host = client(),
      guest = client();
    await host.host({ code: 'ABCDE' });
    host.accepting = false;
    await expect(guest.join('ABCDE')).rejects.toThrow('closed');
    host.accepting = true;
    host.maxPlayers = 1;
    await expect(guest.join('ABCDE')).rejects.toThrow('full');
    await expect(guest.join('XXXXX')).rejects.toThrow('no lobby');
    await expect(guest.join('')).rejects.toThrow('enter a lobby code');
    expect(makeCode()).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
  });

  it('accepts authority messages only from the host and prevents sender impersonation', async () => {
    const { client } = setup();
    const host = client(),
      a = client(),
      b = client();
    await host.host({ code: 'ABCDE' });
    await a.join('ABCDE');
    await b.join('ABCDE');
    const authority = vi.fn();
    b.onHost('end', authority);
    a.broadcast('end', { winner: a.id });
    await flushMessages();
    expect(authority).not.toHaveBeenCalled();
    host.send('end', { winner: b.id });
    await flushMessages();
    expect(authority).toHaveBeenCalledOnce();
    const handler = vi.fn();
    b.on('test', handler);
    a.conns.get(host.id).send({ t: 'test', d: {}, to: b.id, from: 'impersonator' });
    await flushMessages();
    expect(handler).toHaveBeenCalledWith({}, a.id);
    for (const value of [
      null,
      [],
      {},
      { t: 1 },
      { t: 'x', relay: 'yes' },
      { t: 'x', to: 4 },
      { t: 'x', from: 4 },
    ])
      expect(isWireMessage(value)).toBe(false);
    expect(isWireMessage({ t: 'x', d: [] })).toBe(true);
  });

  it('ignores a stale connection close and malformed incoming packets', () => {
    const { client } = setup();
    const host = client();
    const old = new EventEmitter();
    old.peer = 'guest';
    const current = new EventEmitter();
    current.peer = 'guest';
    host.conns.set('guest', current);
    host._wire(old);
    old.emit('close');
    expect(host.conns.get('guest')).toBe(current);
    const handler = vi.fn();
    host.on('test', handler);
    old.emit('data', null);
    old.emit('data', { t: {} });
    expect(handler).not.toHaveBeenCalled();
    host._route(null, 'guest');
  });

  it('times out signaling and destroys the unfinished peer', async () => {
    vi.useFakeTimers();
    const instance = new EventEmitter();
    instance.destroy = vi.fn();
    class SilentPeer {
      constructor() {
        return instance;
      }
    }
    const client = new Net({ PeerClass: SilentPeer, options: async () => ({}) });
    clients.push(client);
    const promise = client._newPeer(null);
    const failure = expect(promise).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(12001);
    await failure;
    expect(instance.destroy).toHaveBeenCalledOnce();
  });
});
