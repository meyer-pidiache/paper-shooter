import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { RemoteRoster } from '../../src/application/remote-roster.js';
import { Net } from '../../src/network/peer-transport.js';
import { RejoinCredentials } from '../../src/network/rejoin-credentials.js';
import { flushMessages, peerNetwork } from '../support/peer-network.js';

const clients = [];
afterEach(() => {
  for (const client of clients) client.leave();
  clients.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('recovers the authenticated Teams seat on standby when the first seated channel loses welcome', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('crypto', webcrypto);
  const { Peer } = peerNetwork();
  const alias = 'standby-ABCDE';
  const canonical = `${alias}-1`;
  const events = [];
  let atDrop;
  class DroppingPeer extends Peer {
    connect(endpoint, options) {
      const connection = super.connect(endpoint, options);
      const incoming = connection.other;
      if (!incoming || !options.metadata.rejoinMatch) return connection;
      const send = incoming.send.bind(incoming);
      incoming.send = (packet) => {
        if (packet.t !== 'welcome') return send(packet);
        if (packet.d.rejoinChallenge) {
          events.push(['challenge', endpoint]);
          return send(packet);
        }
        if (endpoint !== alias) return send(packet);
        // Drop delivery after the host seats this connection, before the guest can adopt it.
        queueMicrotask(() => {
          atDrop = { seats: host.peerIds, score: scores.get(this.id), bank: { ...lobby.teamBank } };
          connection.close();
          events.push(['drop', endpoint, { ...lobby.teamBank }]);
        });
      };
      return connection;
    }
  }
  const make = (rejoinCredentials = new RejoinCredentials(null), PeerClass = Peer) => {
    const net = new Net({
      PeerClass,
      options: async () => ({}),
      namespace: 'standby-',
      rejoinCredentials,
    });
    clients.push(net);
    return net;
  };
  const host = make();
  const credentials = new RejoinCredentials(null);
  const guest = make(credentials);
  const priorBank = { red: 7, blue: 6 };
  const lobby = { mode: 'teams', isPublic: false, players: new Map(), teamBank: { ...priorBank } };
  const scores = new Map();
  let phase = 'lobby';
  const roster = new RemoteRoster({
    transport: host,
    lobby,
    scores,
    peers: new Map(),
    createPeer: (_id, name) => ({ name, setColor() {}, dispose() {} }),
    map: () => 'district',
    phase: () => phase,
    inMatch: () => phase === 'play',
    brokenIds: () => [],
    farthestSpawnIndex: () => 0,
    render() {},
    sendScores() {},
    feed() {},
  });
  host.onPeerJoin = (id, metadata, previous) => roster.join(id, metadata, previous);
  host.onPeerProof = (match, verifier) => roster.resumeProof(match, verifier);
  host.canSeatPeer = (id, previous) => roster.canSeat(id, previous);
  host.onPeerLeave = (id) => roster.peerLeave(id);

  await host.host({ code: 'ABCDE-1' });
  lobby.players.set(host.id, { name: 'host', team: 'red' });
  host.claimAlias('ABCDE');
  await vi.advanceTimersByTimeAsync(1500);
  await guest.join('ABCDE', { name: 'paper' });
  const previous = guest.id;
  const score = { name: 'paper', team: lobby.players.get(previous).team, kills: 4, deaths: 2 };
  phase = 'play';
  host.inMatch = true;
  scores.set(previous, score);
  roster.beginMatch();
  await flushMessages();
  expect(credentials.getProof('ABCDE')).toBeDefined();
  guest.leave();
  const banked = { ...priorBank, [score.team]: priorBank[score.team] + score.kills };
  expect(lobby.teamBank).toEqual(banked);

  const returning = make(credentials, DroppingPeer);
  await expect(returning.join('ABCDE', { name: 'paper' })).resolves.toBe('ABCDE');
  expect(events).toEqual([
    ['challenge', alias],
    ['challenge', canonical],
    ['drop', alias, banked],
  ]);
  expect(atDrop).toEqual({ seats: [returning.id], score, bank: priorBank });
  expect(returning.hostId).toBe(canonical);
  expect(returning.authorityId).toBe(canonical);
  expect(host.peerIds).toEqual([returning.id]);
  expect([...lobby.players.keys()]).toEqual([host.id, returning.id]);
  expect([...scores]).toEqual([[returning.id, score]]);
  expect(lobby.teamBank).toEqual(priorBank);
});
