// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { applicationFixture } from '../support/application.js';
import { peerNetwork, flushMessages } from '../support/peer-network.js';
import { Net } from '../../src/network/peer-transport.js';
const fixtures = [];
afterEach(() => {
  for (const fixture of fixtures) fixture.app.dispose();
  fixtures.length = 0;
  vi.clearAllTimers();
  vi.useRealTimers();
});
it(
  'recovers a silent host without losing the successor identity before election',
  { timeout: 10000 },
  async () => {
    vi.useFakeTimers();
    const { Peer } = peerNetwork();
    const make = () => {
      const fixture = applicationFixture('district', {
        net: new Net({
          PeerClass: Peer,
          options: async () => ({}),
          namespace: 'silent-host-test-',
        }),
      });
      fixtures.push(fixture);
      return fixture;
    };
    const host = make(),
      successor = make();
    await host.app.multiplayer.createLobby(false);
    const code = host.net.code,
      hostId = host.net.id;
    await successor.app.multiplayer.joinLobby(code);
    await flushMessages();
    host.app.session.hostStart();
    await flushMessages();
    const channel = successor.net.conns.get(hostId);
    // Simulate a lost endpoint with no data or close/error event delivered to its follower.
    channel.open = false;
    channel.other.open = false;
    host.net.peer.destroy();
    successor.remote.get(hostId).lastSeen = 1;
    await vi.advanceTimersByTimeAsync(10001);
    successor.app.multiplayer.netUpdate(0.016);
    await flushMessages();
    await vi.advanceTimersByTimeAsync(1600);
    await flushMessages();
    expect(successor.net.isHost).toBe(true);
    expect(successor.net.code).toBe(code + '-1');
    expect(successor.game.state).toBe('play');
    expect(successor.remote.has(hostId)).toBe(false);
  },
);

it(
  'preserves the promoted host team, follower teams, scores, and banked host kills in a 2v2 handoff',
  { timeout: 10000 },
  async () => {
    vi.useFakeTimers();
    const { Peer } = peerNetwork();
    const make = () => {
      const fixture = applicationFixture('district', {
        net: new Net({
          PeerClass: Peer,
          options: async () => ({}),
          namespace: 'team-handoff-test-',
        }),
      });
      fixtures.push(fixture);
      return fixture;
    };
    const host = make(),
      successor = make(),
      redAlly = make(),
      blueAlly = make();
    await host.app.multiplayer.createLobby(false);
    const code = host.net.code,
      hostId = host.net.id;
    host.lobby.mode = 'teams';
    host.app.multiplayer.broadcastLobby();
    await flushMessages();
    await successor.app.multiplayer.joinLobby(code);
    await flushMessages();
    await redAlly.app.multiplayer.joinLobby(code);
    await flushMessages();
    await blueAlly.app.multiplayer.joinLobby(code);
    await flushMessages();
    expect(host.lobby.players.get(hostId)?.team).toBe('red');
    expect(host.lobby.players.get(successor.net.id)?.team).toBe('blue');
    expect(host.lobby.players.get(redAlly.net.id)?.team).toBe('red');
    expect(host.lobby.players.get(blueAlly.net.id)?.team).toBe('blue');
    host.app.session.hostStart();
    await flushMessages();
    host.scores.get(hostId).kills = 4;
    host.scores.get(successor.net.id).kills = 3;
    host.scores.get(redAlly.net.id).kills = 2;
    host.scores.get(blueAlly.net.id).kills = 1;
    host.app.match.sendScores();
    await flushMessages();
    for (const peer of [successor, redAlly, blueAlly]) {
      const channel = peer.net.conns.get(hostId);
      channel.open = false;
      channel.other.open = false;
      peer.remote.get(hostId).lastSeen = 1;
    }
    host.net.peer.destroy();
    await vi.advanceTimersByTimeAsync(10001);
    for (const peer of [successor, redAlly, blueAlly]) peer.app.multiplayer.netUpdate(0.016);
    await flushMessages();
    await vi.advanceTimersByTimeAsync(3000);
    await flushMessages();
    expect(successor.net.isHost).toBe(true);
    expect(successor.game.state).toBe('play');
    expect(successor.lobby.mode).toBe('teams');
    expect(successor.lobby.teamBank).toEqual({ red: 4, blue: 0 });
    expect(successor.lobby.players.get(successor.net.id)?.team).toBe('blue');
    expect(successor.lobby.players.get(redAlly.net.id)?.team).toBe('red');
    expect(successor.lobby.players.get(blueAlly.net.id)?.team).toBe('blue');
    expect(successor.scores.get(successor.net.id)).toMatchObject({ team: 'blue', kills: 3 });
    expect(successor.scores.get(redAlly.net.id)).toMatchObject({ team: 'red', kills: 2 });
    expect(successor.scores.get(blueAlly.net.id)).toMatchObject({ team: 'blue', kills: 1 });
    expect(redAlly.lobby.players.get(successor.net.id)?.team).toBe('blue');
    expect(blueAlly.lobby.players.get(successor.net.id)?.team).toBe('blue');
  },
);
