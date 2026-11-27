// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { applicationFixture } from '../support/application.js';
import { peerNetwork, flushMessages } from '../support/peer-network.js';
import { Net } from '../../src/network/peer-transport.js';
import { webcrypto } from 'node:crypto';
import { once } from 'node:events';
import { clearTimeout as clearRealTimeout, setTimeout as setRealTimeout } from 'node:timers';
import { NavGrid } from '../../src/engine/navigation.js';
import { RejoinCredentials } from '../../src/network/rejoin-credentials.js';
import { createRejoinKey, signRejoin } from '../../src/network/rejoin-proof.js';
const fixtures = [];
function skipSoloNavigation() {
  // These cases exercise online matches, not enemy pathfinding. Keep the real arena and collision world.
  vi.spyOn(NavGrid.prototype, 'build').mockImplementation(function () {
    return this;
  });
}

async function withinStep(label, operation) {
  let timer;
  const controller = new AbortController();
  // WebCrypto and event callbacks still run on real time when the migration clock is faked.
  const deadline = new Promise((_, reject) => {
    timer = setRealTimeout(() => reject(new Error(`${label} did not complete within 2s`)), 2000);
  });
  try {
    return await Promise.race([deadline, operation(controller.signal)]);
  } finally {
    clearRealTimeout(timer);
    controller.abort();
  }
}

function nextEvent(label, emitter, event) {
  return withinStep(label, (signal) => once(emitter, event, { signal }));
}
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

it.each(['teams', 'ffa'])(
  'recovers a legacy %s seat and makes it portable when supported',
  async (mode) => {
    skipSoloNavigation();
    vi.useFakeTimers();
    vi.stubGlobal('crypto', webcrypto);
    const { Peer } = peerNetwork();
    const make = (rejoinCredentials = new RejoinCredentials(null)) => {
      const fixture = applicationFixture('district', {
        net: new Net({
          PeerClass: Peer,
          options: async () => ({}),
          namespace: 'token-recovery-',
          rejoinCredentials,
        }),
      });
      fixtures.push(fixture);
      return fixture;
    };
    const saved = new RejoinCredentials(null);
    const host = make();
    const successor = make();
    const guest = make(saved);
    await host.app.multiplayer.createLobby(true);
    const code = host.net.code;
    host.lobby.mode = mode;
    host.app.multiplayer.broadcastLobby();
    await successor.app.multiplayer.joinLobby(code);
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    await guest.app.multiplayer.joinLobby(code);
    await flushMessages();
    host.app.session.hostStart();
    await flushMessages();
    const departed = { kills: 4, deaths: 2, ...(mode === 'teams' ? { team: 'red' } : {}) };
    Object.assign(host.scores.get(guest.net.id), departed);
    host.scores.get(host.net.id).kills = 3;
    host.app.match.sendScores();
    await flushMessages();
    const token = saved.get(code);
    expect(token).toBeDefined();
    expect(saved.getProof(code)).toBeUndefined();
    guest.net.leave();
    await flushMessages();

    const returning = make(saved);
    let interruptedBinding;
    let lastSnapshot;
    if (mode === 'teams') {
      vi.stubGlobal('crypto', webcrypto);
      successor.net.conns.get(host.net.id).on('data', (packet) => {
        if (packet.t === 'lobby') lastSnapshot = packet.d.rejoins;
      });
      let interruptedId;
      host.net.peer.once('connection', (connection) => {
        interruptedId = connection.peer;
        connection.other.on('data', ({ t, d }) => {
          // The host accepted the token, but this channel closes before the next lobby packet.
          if (t === 'welcome' && !d.rejoinKey) connection.close();
        });
      });
      await withinStep('interrupted token recovery', () => returning.net.quickJoin());
      await flushMessages();
      expect(returning.net.active).toBe(false);
      expect(saved.get(code)).toEqual(token);
      expect(saved.getProof(code)).toBeUndefined();
      expect(host.lobby.players.has(interruptedId)).toBe(false);
      expect(host.scores.has(interruptedId)).toBe(false);
      expect(host.lobby.teamBank).toEqual({ red: 4, blue: 0 });
      interruptedBinding = lastSnapshot.bindings.find(({ id }) => id === interruptedId);
      expect(interruptedBinding).toMatchObject({
        verifier: expect.stringMatching(/^04[a-f0-9]{128}$/),
        pending: { score: departed },
      });
    }
    await withinStep('token recovery retry', () => returning.app.multiplayer.quickPlay());
    await flushMessages();
    expect(host.scores.get(returning.net.id)).toMatchObject(departed);
    if (mode === 'ffa') {
      expect(saved.get(code)).toBeDefined();
      expect(saved.getProof(code)).toBeUndefined();
      expect(host.scores.get(returning.net.id).team).toBeUndefined();
      expect(host.lobby.teamBank).toEqual({ red: 0, blue: 0 });
      return;
    }
    expect(host.lobby.players.get(returning.net.id)?.team).toBe('red');
    expect(host.lobby.teamBank).toEqual({ red: 0, blue: 0 });
    expect([...host.lobby.players.keys()]).toEqual([
      host.net.id,
      successor.net.id,
      returning.net.id,
    ]);
    const proof = saved.getProof(code);
    expect(proof).toMatchObject({ hostId: host.net.id, match: lastSnapshot.match });
    expect(proof.verifier).not.toBe(interruptedBinding.verifier);
    expect(
      lastSnapshot.bindings.filter(
        ({ id, verifier }) => id === returning.net.id || verifier === interruptedBinding.verifier,
      ),
    ).toEqual([{ id: returning.net.id, verifier: proof.verifier }]);
    const returnedId = returning.net.id;
    returning.net.leave();
    await flushMessages();
    expect(successor.lobby.teamBank).toEqual({ red: 4, blue: 0 });
    host.net.leave();
    await vi.advanceTimersByTimeAsync(3000);
    await flushMessages();
    expect(successor.net.code).toBe(code + '-1');
    expect(successor.lobby.teamBank).toEqual({ red: 7, blue: 0 });

    const migrated = make(saved);
    await migrated.app.multiplayer.joinLobby(code);
    await flushMessages();
    expect(successor.scores.get(migrated.net.id)).toMatchObject(departed);
    expect(successor.lobby.players.get(migrated.net.id)?.team).toBe('red');
    expect(successor.scores.has(returnedId)).toBe(false);
    expect(successor.lobby.teamBank).toEqual({ red: 3, blue: 0 });
    expect(saved.getProof(code)).toMatchObject({
      hostId: successor.net.id,
      match: proof.match,
      verifier: proof.verifier,
    });
  },
);

it('Quick Play prefers the match most recently played by explicit proof rejoin', async () => {
  skipSoloNavigation();
  vi.stubGlobal('crypto', webcrypto);
  const { Peer } = peerNetwork();
  const saved = new RejoinCredentials(null);
  const make = (rejoinCredentials = new RejoinCredentials(null)) => {
    const fixture = applicationFixture('district', {
      net: new Net({
        PeerClass: Peer,
        options: async () => ({}),
        namespace: 'proof-recency-',
        rejoinCredentials,
      }),
    });
    fixtures.push(fixture);
    return fixture;
  };
  const first = make(),
    second = make(),
    a = make(saved),
    b = make(saved);
  for (const [host, guest] of [
    [first, a],
    [second, b],
  ]) {
    await host.app.multiplayer.createLobby(true);
    host.lobby.mode = 'teams';
    await withinStep('guest join', () => guest.app.multiplayer.joinLobby(host.net.code));
    host.app.session.hostStart();
    await flushMessages();
    expect(saved.getProof(host.net.code)?.hostId).toBe(host.net.id);
  }
  expect(saved.latestPublicRecovery('proof-recency-', 16)?.hostId).toBe(second.net.id);

  const returned = make(saved);
  expect(await withinStep('explicit proof rejoin', () => returned.net.join(first.net.code))).toBe(
    first.net.code,
  );
  await flushMessages();
  expect(first.net.peerIds).toEqual([returned.net.id]);
  second.app.multiplayer.broadcastLobby();
  second.app.multiplayer.broadcastLobby();
  await flushMessages();

  const quick = make(saved);
  expect(await withinStep('Quick Play proof rejoin', () => quick.net.quickJoin())).toBe(
    first.net.code,
  );
  expect(quick.net.authorityId).toBe(first.net.id);
  expect(second.net.peerIds).toEqual([b.net.id]);
});

it('restores a disconnected Teams row across migration and transfers its banked kills atomically', async () => {
  skipSoloNavigation();
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
  const host = make(),
    successor = make(),
    guest = make(saved),
    follower = make();
  await host.app.multiplayer.createLobby(true);
  const code = host.net.code;
  const hostId = host.net.id;
  host.lobby.mode = 'teams';
  host.app.multiplayer.broadcastLobby();
  for (const peer of [successor, guest, follower])
    await withinStep('initial guest join', () => peer.app.multiplayer.joinLobby(code));
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
  const credential = new RejoinCredentials({ getItem: (key) => saved.get(key) ?? null }).getProof(
    code,
  );
  expect(credential).toBeDefined();
  const attacker = new Peer(null, {});
  await nextEvent('test peer open', attacker, 'open');
  const challenge = async (answer) => {
    const connection = attacker.connect(successor.net.id, {
      metadata: {
        resume: true,
        prev: guestId,
        rejoinMatch: credential.match,
        rejoinVerifier: credential.verifier,
      },
    });
    const response = withinStep(
      'rejoin response',
      () =>
        new Promise((resolve) => {
          connection.on('data', async ({ t, d }) => {
            if (t === 'welcome' && d.rejoinChallenge) {
              connection.send({ t: 'stay', d: { proof: await answer(d.rejoinChallenge) } });
            } else resolve({ t, reason: d.reason });
          });
        }),
    );
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
  const [{ t }] = await nextEvent('ordinary join response', forgedPrevious, 'data');
  expect(t).toBe('welcome');
  expect(successor.scores.get(attacker.id)).toMatchObject({ kills: 0, deaths: 0 });
  forgedPrevious.close();
  const reusedId = new Peer(guestId, {});
  await nextEvent('existing seat ID peer open', reusedId, 'open');
  const reusedConnection = reusedId.connect(successor.net.id, { metadata: {} });
  const [refusal] = await nextEvent('existing seat ID response', reusedConnection, 'data');
  expect(refusal).toMatchObject({ t: 'refused', d: { reason: 'score recovery is unavailable' } });
  reusedConnection.close();
  reusedId.destroy();
  expect(successor.lobby.teamBank).toEqual({ red: 7, blue: 0 });
  expect(successor.scores.has(guestId)).toBe(false);
  const watchProof = (connection) =>
    connection.on('data', ({ t, d }) => {
      if (t === 'stay' && d?.proof) signed = d.proof;
    });
  let signed;
  successor.net.peer.on('connection', watchProof);
  successor.net.alias?.on('connection', watchProof);
  const observed = [];
  follower.net.conns.get(follower.net.hostId).on('data', (packet) => {
    packets.push(packet);
    if (packet.t === 'lobby' || packet.t === 'score')
      observed.push(
        follower.lobby.teamBank.red +
          [...follower.scores.values()]
            .filter((row) => row.team === 'red')
            .reduce((sum, row) => sum + row.kills, 0),
      );
  });
  const returning = make(saved);
  await withinStep('returning guest join', () => returning.app.multiplayer.joinLobby(code));
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
  await withinStep('replacement Quick Play', () => replacement.app.multiplayer.quickPlay());
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
