import { knownMap, type MapKey } from '../domain/maps.js';
import { FFA_TIME, type GamePhase, type Score } from '../domain/match.js';
import type { GamePayloads } from '../network/game-message-types.js';
import { isRecord } from '../shared/ice.js';
import type { LobbyState } from './lobby-contracts.js';
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
    sendTo(id: string, kind: 'start', data: GamePayloads['start']): void;
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
  constructor(private readonly ports: RosterPorts<Peer>) {}
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
        shown: transport.aliasCode || transport.code || undefined,
        duration: lobby.duration ?? FFA_TIME,
      });
    render();
  }
  peerLeave(id: string) {
    const { lobby, inMatch, feed, sendScores } = this.ports;
    const name = lobby.players.get(id)?.name;
    this.remove(id);
    this.broadcast();
    if (inMatch()) {
      feed((name || 'someone') + ' left');
      sendScores();
    }
  }
  join(id: string, metadata: unknown) {
    const {
      lobby,
      scores,
      phase,
      transport,
      map,
      brokenIds,
      farthestSpawnIndex,
      sendScores,
      feed,
    } = this.ports;
    const meta = isRecord(metadata) ? metadata : {};
    const name = typeof meta.name === 'string' ? meta.name.slice(0, 14) : 'paper';
    if (typeof meta.prev === 'string' && meta.prev && meta.prev !== id) this.replace(meta.prev, id);
    lobby.players.set(id, { name });
    this.add(id, name);
    this.broadcast();
    if (phase() === 'play' || phase() === 'dying') {
      if (!scores.has(id)) scores.set(id, { name, kills: 0, deaths: 0 });
      transport.sendTo(id, 'start', {
        late: true,
        duration: lobby.duration ?? FFA_TIME,
        clock: this.ports.clock?.(),
        spawn: farthestSpawnIndex(),
        map: lobby.map || map(),
        broken: brokenIds(),
      });
      sendScores();
      feed(name + ' joined');
    }
  }
  receive(data: GamePayloads['lobby']) {
    const { lobby, transport, peers, inMatch, scores, refreshScores, render } = this.ports;
    lobby.hostId = data.hostId;
    lobby.isPublic = !!data.isPublic;
    lobby.code = transport.code || '';
    lobby.shown = data.shown || transport.code;
    if (data.map) lobby.map = knownMap(data.map);
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
    const { scores, peers, lobby } = this.ports;
    const score = scores.get(previous);
    if (score) {
      scores.delete(previous);
      scores.set(id, score);
    }
    peers.get(previous)?.dispose();
    peers.delete(previous);
    lobby.players.delete(previous);
    if (lobby.order) lobby.order = lobby.order.filter((peer) => peer !== previous);
  }
}
