import { expect, it, vi } from 'vitest';
import { NetworkSync, type NetworkSyncPorts } from '../../src/application/network-sync.js';
function fixture() {
  const events: unknown[] = [];
  const record = (label: string) =>
    vi.fn((...args: unknown[]) => {
      events.push([label, ...args]);
    });
  const transport = {
    active: true,
    isHost: true,
    hostId: 'host',
    conns: new Map<string, { close(): void }>(),
    leave: record('leave'),
    send: record('send'),
    broadcast: record('broadcast'),
  };
  const peers = new Map([['guest', { name: 'paper', lastSeen: 0, update: record('replica') }]]);
  const ports: NetworkSyncPorts = {
    transport,
    player: {
      body: { pos: { x: 1.234, y: 2, z: 3 }, vel: { x: 4.567, y: 5, z: 6 }, onGround: true },
      yaw: 0,
      pitch: 0,
      crouching: false,
      sliding: false,
      isBlocking: false,
      _aiming: false,
      alive: true,
      parryWindow: false,
      hp: 100,
      weaponIndex: 0,
      firing: true,
      weapon: { kind: 'rifle' },
    },
    opponents: () => peers,
    shotQueue: [],
    inMatch: () => true,
    migrating: () => false,
    idleSeconds: () => 30,
    now: () => 10001,
    idle: record('idle'),
    clock: record('clock'),
    remove: vi.fn((id) => {
      events.push(['remove', id]);
      peers.delete(id);
    }),
    migrate: vi.fn(async () => {
      events.push(['migrate']);
    }),
    feed: record('feed'),
    broadcastLobby: record('lobby'),
    sendScores: record('scores'),
  };
  return { ports, transport, peers, events, owner: new NetworkSync(ports) };
}
it('orders idle, replicas, snapshots, queued shots and clock, retaining exact snapshot/idle encoding', () => {
  const { ports, owner, events } = fixture();
  owner.update(0.1);
  owner.update(0.1);
  events.length = 0;
  ports.shotQueue.push(1, 2, 3);
  owner.update(0.1, 0.25, 9999);
  expect(events).toEqual([
    ['idle', 0.1],
    ['replica', 0.1, 10.001],
    ['send', 'ps', [1.23, 2, 3, 0, 0, 0, 112, 100, 4.6, 5, 6], true],
    ['broadcast', 'shots', { k: 'rifle', e: [1, 2, 3] }],
    ['clock', 0.25, 9999],
  ]);
  expect(ports.shotQueue).toEqual([]);
  ports.idleSeconds = () => 30.01;
  owner.update(0.1);
  owner.update(0.1);
  owner.update(0.1);
  expect(ports.transport.send).toHaveBeenLastCalledWith(
    'ps',
    [1.23, 2, 3, 0, 0, 0, 624, 100, 4.6, 5, 6],
    true,
  );
});
it('retires a silent guest in order, tolerates a closed channel and suppresses stale cleanup during migration', () => {
  const { owner, ports, peers, transport, events } = fixture();
  const peer = peers.get('guest');
  if (!peer) throw new Error('missing guest');
  peer.lastSeen = 1;
  const close = vi.fn(() => {
    events.push(['close']);
    throw new Error('already closed');
  });
  transport.conns.set('guest', { close });
  ports.migrating = () => true;
  owner.update(0.1);
  expect(ports.remove).not.toHaveBeenCalled();
  ports.migrating = () => false;
  events.length = 0;
  owner.update(0.1);
  expect(events).toEqual([
    ['idle', 0.1],
    ['replica', 0.1, 10.001],
    ['remove', 'guest'],
    ['feed', 'paper lost connection'],
    ['close'],
    ['send', 'leave', { id: 'guest' }],
    ['lobby'],
    ['scores'],
    ['clock', 0.1, 10001],
  ]);
  expect(transport.conns.size).toBe(0);
});
it('requests host recovery once and retains the captured update remainder after recovery retires the transport', () => {
  const { owner, ports, peers, transport, events } = fixture();
  const peer = peers.get('guest');
  if (!peer) throw new Error('missing guest');
  peer.lastSeen = 1;
  transport.isHost = false;
  transport.hostId = 'guest';
  ports.migrate = vi.fn(async () => {
    transport.active = false;
    events.push(['migrate']);
  });
  ports.shotQueue.push(1, 2, 3);
  owner.update(0.1);
  expect(events).toEqual([
    ['idle', 0.1],
    ['replica', 0.1, 10.001],
    ['migrate'],
    ['broadcast', 'shots', { k: 'rifle', e: [1, 2, 3] }],
    ['clock', 0.1, 10001],
  ]);
  expect(ports.remove).not.toHaveBeenCalled();
  expect(transport.leave).not.toHaveBeenCalled();
  owner.update(0.1);
  expect(ports.migrate).toHaveBeenCalledOnce();
  expect(events.at(-1)).toEqual(['idle', 0.1]);
});
