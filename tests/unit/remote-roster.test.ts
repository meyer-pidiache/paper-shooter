import { expect, it, vi } from 'vitest';
import { RemoteRoster, type RosterPorts } from '../../src/application/remote-roster.js';
import type { LobbyState } from '../../src/application/lobby-contracts.js';
import type { Score } from '../../src/domain/match.js';
function fixture() {
  const peers = new Map<string, { name: string; dispose(): void }>();
  const lobby: LobbyState = {
    players: new Map(),
    hostId: 'host',
    isPublic: false,
    status: '',
    code: '',
    map: null,
  };
  const scores = new Map<string, Score>();
  const ports: RosterPorts<{ name: string; dispose(): void }> = {
    peers,
    lobby,
    scores,
    transport: { id: 'host', code: 'ABCDE', send: vi.fn(), sendTo: vi.fn() },
    createPeer: vi.fn((id, name) => ({ name, dispose: vi.fn() })),
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
