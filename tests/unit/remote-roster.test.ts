import { expect, it, vi } from 'vitest';
import {
  RemoteRoster,
  type RosterPeer,
  type RosterPorts,
} from '../../src/application/remote-roster.js';
import type { LobbyState } from '../../src/application/lobby-contracts.js';
import type { Score } from '../../src/domain/match.js';
function fixture() {
  const peers = new Map<string, RosterPeer>();
  const lobby: LobbyState = {
    players: new Map(),
    hostId: 'host',
    isPublic: false,
    status: '',
    code: '',
    map: null,
  };
  const scores = new Map<string, Score>();
  const ports: RosterPorts<RosterPeer> = {
    peers,
    lobby,
    scores,
    transport: { id: 'host', code: 'ABCDE', send: vi.fn(), sendTo: vi.fn() },
    createPeer: vi.fn((_id, name) => ({ name, dispose: vi.fn(), setColor: vi.fn() })),
    map: () => 'mexico',
    phase: () => 'lobby',
    inMatch: () => false,
    brokenIds: () => [],
    farthestSpawnIndex: () => 3,
    render: vi.fn(),
    sendScores: vi.fn(),
    refreshScores: vi.fn(),
    feed: vi.fn(),
  };
  return { ports, peers, lobby, scores, owner: new RemoteRoster(ports) };
}
it('reuses a renamed replica and removes its resources roster and score together', () => {
  const { ports, owner, peers, lobby, scores } = fixture();
  const first = owner.add('guest', 'before');
  expect(owner.add('guest', 'after')).toBe(first);
  expect(first.name).toBe('after');
  expect(ports.createPeer).toHaveBeenCalledOnce();
  lobby.players.set('guest', { name: 'after' });
  scores.set('guest', { name: 'after', kills: 2, deaths: 1 });
  owner.remove('guest');
  owner.remove('guest');
  expect(first.dispose).toHaveBeenCalledOnce();
  expect(peers.size).toBe(0);
  expect(lobby.players.size).toBe(0);
  expect(scores.size).toBe(0);
});
it('accepts unknown handshake metadata through guarded fields without map actor or DOM dependencies', () => {
  const { owner, lobby, scores, ports } = fixture();
  owner.join('guest', null);
  expect(owner.rows()).toEqual([{ id: 'guest', name: 'paper' }]);
  owner.join('other', { name: 42, prev: { id: 'guest' } });
  expect(lobby.players.has('guest')).toBe(true);
  expect(scores.size).toBe(0);
  expect(ports.transport.sendTo).not.toHaveBeenCalled();
  expect(ports.transport.send).toHaveBeenLastCalledWith('lobby', {
    players: [
      { id: 'guest', name: 'paper' },
      { id: 'other', name: 'paper' },
    ],
    hostId: 'host',
    isPublic: false,
    map: 'mexico',
    shown: 'ABCDE',
    duration: 300,
  });
});

it('keeps legacy and invalid color fields from breaking the roster', () => {
  const { owner, peers, lobby, ports } = fixture();
  owner.receive({
    hostId: 'host',
    isPublic: false,
    players: [
      { id: 'host', name: 'paper' },
      { id: 'legacy', name: 'legacy' },
      { id: 'invalid', name: 'invalid', color: { name: 'blue' } },
      { id: 'valid', name: 'valid', color: 'green' },
    ],
  });
  expect(ports.createPeer).toHaveBeenCalledWith('legacy', 'legacy', 'original');
  expect(ports.createPeer).toHaveBeenCalledWith('invalid', 'invalid', 'original');
  expect(ports.createPeer).toHaveBeenCalledWith('valid', 'valid', 'green');
  owner.setColor('valid', 'blue');
  expect(peers.get('valid')?.setColor).toHaveBeenLastCalledWith('blue');
  expect(lobby.players.get('valid')?.color).toBe('blue');
});

it('assigns balanced teams and preserves disconnected points on a rejoin', () => {
  const { owner, lobby, scores, ports } = fixture();
  lobby.mode = 'teams';
  lobby.players.set('host', { name: 'host' });
  owner.broadcast();
  owner.join('one', { name: 'one' });
  owner.join('two', { name: 'two' });
  expect([...lobby.players.values()].map((p) => p.team)).toEqual(['red', 'blue', 'red']);
  ports.phase = () => 'play';
  ports.inMatch = () => true;
  Object.defineProperty(ports.transport, 'rejoinKey', { value: 'test-key' });
  owner.beginMatch();
  scores.set('one', { name: 'one', team: 'blue', kills: 4, deaths: 1 });
  owner.peerLeave('one');
  expect(lobby.teamBank).toEqual({ red: 0, blue: 4 });
  owner.join('new-one', { name: 'one' }, 'one');
  expect(lobby.players.get('new-one')?.team).toBe('blue');
  expect(scores.get('new-one')?.kills).toBe(4);
  expect(lobby.teamBank).toEqual({ red: 0, blue: 0 });
});

it('leaves teamBank unchanged when a live peer rejoins without a pending disconnect', () => {
  const { owner, lobby, scores, ports } = fixture();
  lobby.mode = 'teams';
  lobby.players.set('host', { name: 'host' });
  owner.broadcast();
  owner.join('one', { name: 'one' });
  owner.join('two', { name: 'two' });
  owner.join('three', { name: 'three' });
  ports.phase = () => 'play';
  ports.inMatch = () => true;
  Object.defineProperty(ports.transport, 'rejoinKey', { value: 'test-key' });
  owner.beginMatch();
  scores.set('one', { name: 'one', team: 'blue', kills: 5, deaths: 1 });
  scores.set('three', { name: 'three', team: 'blue', kills: 3, deaths: 0 });
  owner.peerLeave('one');
  expect(lobby.teamBank).toEqual({ red: 0, blue: 5 });
  owner.join('new-three', { name: 'three' }, 'three');
  expect(lobby.players.get('new-three')?.team).toBe('blue');
  expect(scores.get('new-three')?.kills).toBe(3);
  expect(lobby.teamBank).toEqual({ red: 0, blue: 5 });
});

it('enforces fixed team colors in team mode and ignores custom ink overrides until FFA', () => {
  const { owner, peers, lobby, ports } = fixture();
  lobby.mode = 'teams';
  lobby.players.set('host', { name: 'host', color: 'green' });
  owner.broadcast();
  owner.join('bluePeer', { name: 'bluePeer', color: 'amber' });
  owner.join('redPeer', { name: 'redPeer', color: 'magenta' });
  expect(ports.createPeer).toHaveBeenCalledWith('bluePeer', 'bluePeer', 'blue');
  expect(ports.createPeer).toHaveBeenCalledWith('redPeer', 'redPeer', 'original');
  owner.setColor('bluePeer', 'green');
  expect(peers.get('bluePeer')?.setColor).toHaveBeenLastCalledWith('blue');
  owner.receive({
    hostId: 'host',
    isPublic: false,
    mode: 'teams',
    players: [
      { id: 'host', name: 'host', color: 'green', team: 'red' },
      { id: 'bluePeer', name: 'bluePeer', color: 'green', team: 'blue' },
      { id: 'redPeer', name: 'redPeer', color: 'magenta', team: 'red' },
    ],
  });
  expect(peers.get('bluePeer')?.setColor).toHaveBeenLastCalledWith('blue');
  expect(peers.get('redPeer')?.setColor).toHaveBeenLastCalledWith('original');
  lobby.mode = 'ffa';
  owner.broadcast();
  expect(peers.get('bluePeer')?.setColor).toHaveBeenLastCalledWith('green');
  expect(peers.get('redPeer')?.setColor).toHaveBeenLastCalledWith('magenta');
});
