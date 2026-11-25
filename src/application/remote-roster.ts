import { knownMap, type MapKey } from '../domain/maps.js';
import { FFA_TIME, type GamePhase, type Score } from '../domain/match.js';
import type { GamePayloads } from '../network/game-message-types.js';
import { isRecord } from '../shared/ice.js';
import type { LobbyState } from './lobby-contracts.js';
import { MatchRejoins } from './match-rejoins.js';
export interface RosterPeer {
  name: string;
  dispose(): void;
}
export interface RosterPorts<Peer extends RosterPeer> {
  peers: Map<string, Peer>;
  lobby: LobbyState;
  scores: Map<string, Score>;
  transport: {
    readonly id: string | null;
    readonly code: string | null;
    readonly aliasCode?: string | null;
    send(kind: 'lobby', data: GamePayloads['lobby']): void;
    sendTo<K extends 'start' | 'rejoin-token'>(id: string, kind: K, data: GamePayloads[K]): void;
    readonly rejoinKey?: string | null;
  };
  createPeer(id: string, name: string): Peer;
  map(): MapKey;
  phase(): GamePhase;
  inMatch(): boolean;
  clock?(): GamePayloads['clock'];
  brokenIds(): number[];
  farthestSpawnIndex(): number;
  render(): void;
  sendScores(): void;
  refreshScores(): void;
  feed(text: string): void;
}
/** Owns replica membership and roster reconciliation, not actor damage or host election. */
export class RemoteRoster<Peer extends RosterPeer> {
  private readonly rejoins = new MatchRejoins();

  constructor(private readonly ports: RosterPorts<Peer>) {}

  beginMatch() {
    const { lobby, transport } = this.ports;
    this.clearRejoins();
    for (const id of lobby.players.keys()) if (id !== transport.id) this.offerRejoin(id);
  }

  clearRejoins() {
    this.rejoins.clear();
  }

  private activeMatch() {
    const phase = this.ports.phase();
    return phase === 'play' || phase === 'dying';
  }

  resumePeer(token: string) {
    if (this.activeMatch()) return this.rejoins.previousId(token);
  }

  private offerRejoin(id: string) {
    const { transport } = this.ports;
    if (transport.rejoinKey)
      transport.sendTo(id, 'rejoin-token', {
        key: transport.rejoinKey,
        token: this.rejoins.track(id),
      });
  }
  add(id: string, name: string): Peer {
    const existing = this.ports.peers.get(id);
    if (existing) {
      existing.name = name;
      return existing;
    }
    const peer = this.ports.createPeer(id, name);
    this.ports.peers.set(id, peer);
    return peer;
  }
  remove(id: string) {
    const { peers, lobby, scores } = this.ports;
    const peer = peers.get(id);
    if (peer) {
      peer.dispose();
      peers.delete(id);
    }
    lobby.players.delete(id);
    scores.delete(id);
    if (lobby.order) lobby.order = lobby.order.filter((peerId) => peerId !== id);
  }
  rows() {
    return [...this.ports.lobby.players].map(([id, player]) => ({ id, name: player.name }));
  }
  broadcast() {
    const { transport, lobby, map, render } = this.ports;
    const id = transport.id;
    if (id !== null)
      transport.send('lobby', {
        players: this.rows(),
        hostId: id,
        isPublic: lobby.isPublic,
        map: lobby.map || map(),
        mapLocked: lobby.mapLocked,
        shown: transport.aliasCode || transport.code || undefined,
        duration: lobby.duration ?? FFA_TIME,
      });
    render();
  }
  peerLeave(id: string, reason = 'left') {
    const { lobby, inMatch, feed, scores, sendScores } = this.ports;
    const name = lobby.players.get(id)?.name;
    if (this.activeMatch()) this.rejoins.disconnect(id, scores.get(id));
    lobby.migrationPeers?.delete(id);
    this.remove(id);
    this.broadcast();
    if (inMatch()) {
      feed((name || 'someone') + ' ' + reason);
      sendScores();
    }
  }
  join(id: string, metadata: unknown, previous?: string) {
    const { lobby, scores, transport, map, brokenIds, farthestSpawnIndex, sendScores, feed } =
      this.ports;
    const meta = isRecord(metadata) ? metadata : {};
    const name = typeof meta.name === 'string' ? meta.name.slice(0, 14) : 'paper';
    if (previous) {
      const score = this.rejoins.restore(previous, id, scores.get(previous));
      this.remove(previous);
      if (score) scores.set(id, { ...score, name });
    } else if (
      typeof meta.prev === 'string' &&
      meta.prev !== id &&
      lobby.migrationPeers?.delete(meta.prev)
    ) {
      this.replace(meta.prev, id);
    }
    lobby.players.set(id, { name });
    this.add(id, name);
    this.broadcast();
    if (this.activeMatch()) {
      if (!scores.has(id)) scores.set(id, { name, kills: 0, deaths: 0 });
      if (!previous) this.offerRejoin(id);
      transport.sendTo(id, 'start', {
        late: true,
        duration: lobby.duration ?? FFA_TIME,
        clock: this.ports.clock?.(),
        spawn: farthestSpawnIndex(),
        map: lobby.map || map(),
        broken: brokenIds(),
      });
      sendScores();
      feed(name + (previous ? ' rejoined' : ' joined'));
    }
  }
  receive(data: GamePayloads['lobby']) {
    const { lobby, transport, peers, inMatch, scores, refreshScores, render } = this.ports;
    lobby.hostId = data.hostId;
    lobby.isPublic = !!data.isPublic;
    lobby.code = transport.code || '';
    lobby.shown = data.shown || transport.code;
    if (data.map) lobby.map = knownMap(data.map);
    lobby.mapLocked = data.mapLocked === true;
    lobby.duration = data.duration ?? FFA_TIME;
    lobby.order = data.players.map((player) => player.id);
    lobby.players.clear();
    for (const player of data.players) lobby.players.set(player.id, { name: player.name });
    for (const player of data.players)
      if (player.id !== transport.id) this.add(player.id, player.name);
    for (const id of [...peers.keys()]) if (!lobby.players.has(id)) this.remove(id);
    if (inMatch()) {
      for (const player of data.players)
        if (!scores.has(player.id))
          scores.set(player.id, { name: player.name, kills: 0, deaths: 0 });
      refreshScores();
    }
    render();
  }
  leave(id: string) {
    const { lobby, inMatch, feed, render } = this.ports;
    const name = lobby.players.get(id)?.name;
    this.remove(id);
    if (inMatch()) feed((name || 'someone') + ' left');
    render();
  }
  private replace(previous: string, id: string) {
    const { scores } = this.ports;
    const score = scores.get(previous);
    this.remove(previous);
    if (score) scores.set(id, score);
  }
}
