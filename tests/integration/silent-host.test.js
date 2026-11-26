// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { applicationFixture } from '../support/application.js';
import { peerNetwork, flushMessages } from '../support/peer-network.js';
import { Net } from '../../src/network/peer-transport.js';
import { webcrypto } from 'node:crypto';
import { RejoinCredentials } from '../../src/network/rejoin-credentials.js';
import { createRejoinKey, signRejoin } from '../../src/network/rejoin-proof.js';
const fixtures = [];
afterEach(() => {
  for (const fixture of fixtures) fixture.app.dispose();
  fixtures.length = 0;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
  'keeps the departing guest’s points if an alias-connected follower loses the host after leave but before the roster commit',
  { timeout: 10000 },
  async () => {
    vi.useFakeTimers();
    const { Peer } = peerNetwork();
    const make = () => {
      const fixture = applicationFixture('district', {
        net: new Net({ PeerClass: Peer, options: async () => ({}), namespace: 'departure-test-' }),
      });
      fixtures.push(fixture);
      return fixture;
    };
    const host = make(),
      successor = make(),
      guest = make();
    await host.app.multiplayer.createLobby(false);
    const code = host.net.code,
      hostId = host.net.id,
      alias = 'ALIAS';
    host.lobby.mode = 'teams';
    host.app.multiplayer.broadcastLobby();
    host.net.claimAlias(alias);
    await vi.advanceTimersByTimeAsync(1600);
    await successor.app.multiplayer.joinLobby(alias);
    await flushMessages();
    await guest.app.multiplayer.joinLobby(code);
    await flushMessages();
    expect(successor.net.hostId).toBe('departure-test-' + alias);
    expect(successor.net.authorityId).toBe(hostId);
    host.app.session.hostStart();
    await flushMessages();
    const guestId = guest.net.id;
    host.scores.get(hostId).kills = 3;
    host.scores.get(guestId).kills = 4;
    host.app.match.sendScores();
    await flushMessages();
    const channel = successor.net.conns.get(successor.net.hostId);
    const received = [];
    channel.on('data', (packet) => {
      received.push(packet.t);
      if (packet.t !== 'leave') return;
      // Cut the wire after application leave handling, with lobby and score already queued.
      channel.open = false;
      channel.other.open = false;
      host.net.peer.destroy();
    });
    guest.net.leave();
    await flushMessages();
    expect(received).toEqual(['leave']);
    expect(host.lobby.players.has(guestId)).toBe(false);
    expect(host.lobby.teamBank).toEqual({ red: 4, blue: 0 });
    expect(successor.lobby.players.has(guestId)).toBe(true);
    expect(successor.scores.get(guestId)).toMatchObject({ team: 'red', kills: 4 });
    successor.remote.get(hostId).lastSeen = 1;
    await vi.advanceTimersByTimeAsync(10001);
    successor.app.multiplayer.netUpdate(0);
    await flushMessages();
    expect(successor.net.isHost).toBe(true);
    expect(successor.net.code).toBe(alias + '-1');
    expect(successor.game.state).toBe('play');
    expect(successor.lobby.players.has(hostId)).toBe(false);
    expect(successor.lobby.teamBank).toEqual({ red: 3, blue: 0 });
    expect(successor.lobby.players.has(guestId)).toBe(true);
    expect(successor.scores.get(guestId)).toMatchObject({ team: 'red', kills: 4 });

    // As the new authority, the successor eventually retires the same disconnected guest.
    successor.remote.get(guestId).lastSeen = 1;
    successor.app.multiplayer.netUpdate(0);
    expect(successor.lobby.players.has(guestId)).toBe(false);
    expect(successor.scores.has(guestId)).toBe(false);
    expect(successor.lobby.teamBank).toEqual({ red: 7, blue: 0 });
  },
);

it('restores a disconnected Teams row across migration and transfers its banked kills atomically', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('crypto', webcrypto);
  const { Peer } = peerNetwork();
  const make = (storage = new Map()) => {
    const fixture = applicationFixture('district', {
      net: new Net({
        PeerClass: Peer,
        options: async () => ({}),
        namespace: 'portable-rejoin-',
        rejoinCredentials: new RejoinCredentials({
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value),
        }),
      }),
    });
    fixtures.push(fixture);
    return fixture;
  };
  const saved = new Map();
  const host = make(), successor = make(), guest = make(saved), follower = make();
  await host.app.multiplayer.createLobby(true);
  const code = host.net.code;
  const hostId = host.net.id;
  host.lobby.mode = 'teams';
  host.app.multiplayer.broadcastLobby();
  for (const peer of [successor, guest, follower]) await peer.app.multiplayer.joinLobby(code);
  await flushMessages();
  const guestId = guest.net.id;
  const departed = { team: 'red', kills: 4, deaths: 2 };
  const packets = [];
  successor.net.conns.get(hostId).on('data', (packet) => packets.push(packet));
  host.app.session.hostStart();
  await flushMessages();
  Object.assign(host.scores.get(guestId), departed);
  host.scores.get(hostId).kills = 3;
  host.app.match.sendScores();
  await flushMessages();
  guest.net.leave();
  await flushMessages();
  expect(successor.scores.has(guestId)).toBe(false);
  expect(successor.lobby.teamBank).toEqual({ red: 4, blue: 0 });
  host.net.leave();
  await vi.advanceTimersByTimeAsync(3000);
  await flushMessages();
  expect(successor.net.code).toBe(code + '-1');
  await vi.waitFor(() => expect(follower.net.authorityId).toBe(successor.net.id));
  const credential = new RejoinCredentials({ getItem: (key) => saved.get(key) ?? null }).getProof(code);
  expect(credential).toBeDefined();
  const attacker = new Peer(null, {});
  await new Promise((resolve) => attacker.on('open', resolve));
  const challenge = async (answer) => {
    const connection = attacker.connect(successor.net.id, { metadata: {
      resume: true, prev: guestId, rejoinMatch: credential.match, rejoinVerifier: credential.verifier,
    } });
    const response = new Promise((resolve) => {
      connection.on('data', async ({ t, d }) => {
        if (t === 'welcome' && d.rejoinChallenge) {
          connection.send({ t: 'stay', d: { proof: await answer(d.rejoinChallenge) } });
        } else resolve({ t, reason: d.reason });
      });
    });
    expect(await response).toEqual({ t: 'refused', reason: 'score recovery is unavailable' });
    connection.close();
    expect(successor.net.conns.has(attacker.id)).toBe(false);
  };
  const wrongKey = await createRejoinKey();
  await challenge((offer) => signRejoin(wrongKey, offer, successor.net.id, attacker.id));
  await challenge((offer) => signRejoin(credential, offer, successor.net.id, guestId));
  const forgedPrevious = attacker.connect(successor.net.id, {
    metadata: { name: 'imposter', prev: guestId, rejoinVerifier: credential.verifier },
  });
  await new Promise((resolve) => forgedPrevious.on('data', ({ t }) => t === 'welcome' && resolve()));
  expect(successor.scores.get(attacker.id)).toMatchObject({ kills: 0, deaths: 0 });
  forgedPrevious.close();
  const reusedId = new Peer(guestId, {});
  await new Promise((resolve) => reusedId.on('open', resolve));
  const reusedConnection = reusedId.connect(successor.net.id, { metadata: {} });
  const refusal = await new Promise((resolve) => reusedConnection.on('data', resolve));
  expect(refusal).toMatchObject({ t: 'refused', d: { reason: 'score recovery is unavailable' } });
  reusedConnection.close();
  reusedId.destroy();
  expect(successor.lobby.teamBank).toEqual({ red: 7, blue: 0 });
  expect(successor.scores.has(guestId)).toBe(false);
  const watchProof = (connection) => connection.on('data', ({ t, d }) => {
    if (t === 'stay' && d?.proof) signed = d.proof;
  });
  let signed;
  successor.net.peer.on('connection', watchProof);
  successor.net.alias?.on('connection', watchProof);
  const observed = [];
  follower.net.conns.get(follower.net.hostId).on('data', (packet) => {
    packets.push(packet);
    if (packet.t === 'lobby' || packet.t === 'score')
      observed.push(follower.lobby.teamBank.red + [...follower.scores.values()]
        .filter((row) => row.team === 'red').reduce((sum, row) => sum + row.kills, 0));
  });
  const returning = make(saved);
  await returning.app.multiplayer.joinLobby(code);
  await flushMessages();
  expect(successor.scores.get(returning.net.id)).toMatchObject(departed);
  expect(follower.scores.get(returning.net.id)).toMatchObject(departed);
  expect(successor.lobby.teamBank).toEqual({ red: 3, blue: 0 });
  expect(observed.length).toBeGreaterThan(0);
  expect(observed.every((total) => total === 7)).toBe(true);
  expect(signed).toMatch(/^[a-f0-9]{128}$/);
  await challenge(() => signed);
  attacker.destroy();
  expect(successor.scores.get(returning.net.id)).toMatchObject(departed);
  expect(successor.lobby.teamBank).toEqual({ red: 3, blue: 0 });
  const nonTargeted = JSON.stringify(packets.filter(({ t }) => t !== 'rejoin-token'));
  for (const value of saved.values()) {
    const visit = (entry) => {
      if (entry === null || typeof entry !== 'object') return;
      for (const [key, child] of Object.entries(entry)) {
        if (['d', 'key', 'token'].includes(key) && typeof child === 'string')
          expect(nonTargeted).not.toContain(child);
        else visit(child);
      }
    };
    visit(JSON.parse(value));
  }
  const replacement = make(saved);
  await replacement.app.multiplayer.quickPlay();
  await flushMessages();
  expect(successor.scores.has(returning.net.id)).toBe(false);
  expect(successor.scores.get(replacement.net.id)).toMatchObject(departed);
  expect(successor.lobby.teamBank).toEqual({ red: 3, blue: 0 });
  expect(observed.every((total) => total === 7)).toBe(true);
});

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
    await vi.waitFor(() => {
      expect(redAlly.net.authorityId).toBe(successor.net.id);
      expect(blueAlly.net.authorityId).toBe(successor.net.id);
    });
    expect(successor.lobby.players.get(redAlly.net.id)?.team).toBe('red');
    expect(successor.lobby.players.get(blueAlly.net.id)?.team).toBe('blue');
    expect(successor.scores.get(successor.net.id)).toMatchObject({ team: 'blue', kills: 3 });
    expect(successor.scores.get(redAlly.net.id)).toMatchObject({ team: 'red', kills: 2 });
    expect(successor.scores.get(blueAlly.net.id)).toMatchObject({ team: 'blue', kills: 1 });
    expect(redAlly.lobby.players.get(successor.net.id)?.team).toBe('blue');
    expect(blueAlly.lobby.players.get(successor.net.id)?.team).toBe('blue');
  },
);
