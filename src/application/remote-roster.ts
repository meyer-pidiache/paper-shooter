import { knownMap, type MapKey } from '../domain/maps.js';
import { FFA_TIME, teamColor, type GamePhase, type Score, type Team } from '../domain/match.js';
import type { GamePayloads } from '../network/game-message-types.js';
import { isRecord } from '../shared/ice.js';
import {
  characterColor,
  DEFAULT_CHARACTER_COLOR,
  type CharacterColor,
} from '../shared/character-color.js';
import type { LobbyState } from './lobby-contracts.js';
import { MatchRejoins } from './match-rejoins.js';
export interface RosterPeer {
  name: string;
  setColor(color: CharacterColor): void;
  dispose(): void;
  setTeamLabel?(team: 'red' | 'blue' | undefined): void;
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
    rejoinVerifierFor?(id: string): unknown;
    clearMatchProof?(): void;
  };
  createPeer(id: string, name: string, color: CharacterColor): Peer;
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
  private readonly leaveHints = new Set<string>();

  constructor(private readonly ports: RosterPorts<Peer>) {}

  beginMatch() {
    const { lobby, transport } = this.ports;
    this.clearRejoins();
    if (lobby.mode === 'teams') this.rejoins.startTeams();
    for (const id of lobby.players.keys()) if (id !== transport.id) this.offerRejoin(id);
    if (this.rejoins.match) this.broadcast();
  }

  clearRejoins() {
    this.ports.transport.clearMatchProof?.();
    this.rejoins.clear();
    this.leaveHints.clear();
  }

  private activeMatch() {
    const phase = this.ports.phase();
    return phase === 'play' || phase === 'dying';
  }

  resumePeer(token: string) {
    if (this.activeMatch()) return this.rejoins.previousId(token);
  }

  resumeProof(match: string, verifier: string) {
    if (this.activeMatch() && this.ports.lobby.mode === 'teams') {
      const previous = this.rejoins.proofId(match, verifier);
      if (previous !== this.ports.transport.id) return previous;
    }
  }

  canSeat(id: string, previous?: string) {
    if (!this.rejoins.match || id === previous) return true;
    // Signaling IDs can be reused after disconnection; a public ID isn't authorization.
    return !this.ports.lobby.players.has(id) && !this.rejoins.protectedId(id);
  }

  reconcileRejoin(previous: string, current?: string) {
    if (current) this.rejoins.rekey(previous, current);
    else this.rejoins.disconnect(previous, this.ports.scores.get(previous));
  }

  private offerRejoin(id: string) {
    const { transport } = this.ports;
    if (this.rejoins.bind(id, transport.rejoinVerifierFor?.(id))) return;
    if (transport.rejoinKey)
      transport.sendTo(id, 'rejoin-token', {
        key: transport.rejoinKey,
        token: this.rejoins.track(id),
      });
  }
  add(id: string, name: string, color = DEFAULT_CHARACTER_COLOR): Peer {
    const existing = this.ports.peers.get(id);
    if (existing) {
      existing.name = name;
      existing.setColor(color);
      return existing;
    }
    const peer = this.ports.createPeer(id, name, color);
    this.ports.peers.set(id, peer);
    return peer;
  }
  private effectiveColor(player: { color?: CharacterColor; team?: Team }): CharacterColor {
    if (this.ports.lobby.mode === 'teams' && player.team) return teamColor(player.team);
    return characterColor(player.color);
  }
  setColor(id: string, selection: unknown) {
    const player = this.ports.lobby.players.get(id);
    if (!player) return;
    const color = characterColor(selection);
    player.color = color;
    this.ports.peers.get(id)?.setColor(this.effectiveColor(player));
  }
  remove(id: string) {
    const { peers, lobby, scores } = this.ports;
    this.leaveHints.delete(id);
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
    return [...this.ports.lobby.players].map(([id, player]) => ({
      id,
      name: player.name,
      ...(player.team ? { team: player.team } : {}),
    }));
  }
  private assignTeam() {
    const members = [...this.ports.lobby.players.values()];
    return members.filter((p) => p.team === 'red').length <=
      members.filter((p) => p.team === 'blue').length
      ? 'red'
      : 'blue';
  }
  broadcast() {
    const { transport, lobby, map, render, scores } = this.ports;
    const id = transport.id;
    if (lobby.mode === 'teams') {
      for (const player of lobby.players.values()) player.team ??= this.assignTeam();
      if (this.ports.phase() === 'lobby' && lobby.players.size > 1) {
        const members = [...lobby.players];
        const firstTeam = members[0][1].team;
        if (members.every(([, player]) => player.team === firstTeam)) {
          const guest = members.reverse().find(([peerId]) => peerId !== id);
          if (guest) guest[1].team = this.assignTeam();
        }
      }
    }
    if (id !== null)
      transport.send('lobby', {
        players: Array.from(lobby.players, ([id, { name, color, team }]) => ({
          id,
          name,
          ...(color && color !== DEFAULT_CHARACTER_COLOR ? { color } : {}),
          ...(team ? { team } : {}),
        })),
        ...(lobby.mode ? { mode: lobby.mode } : {}),
        ...(lobby.mode === 'teams' && lobby.teamBank ? { teamBank: lobby.teamBank } : {}),
        ...(lobby.mode === 'teams' && this.rejoins.match
          ? {
              rejoins: {
                match: this.rejoins.match,
                bindings: this.rejoins.snapshot(),
                scores: [...scores]
                  .filter(([id]) => lobby.players.has(id))
                  .map(([id, score]) => ({ id, ...score })),
              },
            }
          : {}),
        hostId: id,
        isPublic: lobby.isPublic,
        map: lobby.map || map(),
        ...(lobby.mapLocked !== undefined ? { mapLocked: lobby.mapLocked } : {}),
        shown: transport.aliasCode || transport.code || undefined,
        duration: lobby.duration ?? FFA_TIME,
      });
    for (const [peerId, peer] of this.ports.peers) {
      const player = lobby.players.get(peerId);
      peer.setTeamLabel?.(lobby.mode === 'teams' ? player?.team : undefined);
      if (player) peer.setColor(this.effectiveColor(player));
    }
    render();
  }
  peerLeave(id: string, reason = 'left') {
    const { lobby, inMatch, feed, scores, sendScores } = this.ports;
    const name = lobby.players.get(id)?.name;
    if (this.activeMatch()) {
      const score = scores.get(id);
      this.rejoins.disconnect(id, score);
      if (lobby.mode === 'teams' && score?.team) {
        lobby.teamBank ??= { red: 0, blue: 0 };
        lobby.teamBank[score.team] += score.kills;
      }
    }
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
    const color = characterColor(meta.color);
    let restoredTeam: 'red' | 'blue' | undefined;
    if (previous) {
      const score = this.rejoins.restore(previous, id, scores.get(previous), (team, kills) => {
        if (lobby.teamBank) lobby.teamBank[team] = Math.max(0, lobby.teamBank[team] - kills);
      });
      lobby.migrationPeers?.delete(previous);
      restoredTeam = score?.team;
      this.remove(previous);
      if (score) scores.set(id, { ...score, name });
    } else if (
      typeof meta.prev === 'string' &&
      meta.prev !== id &&
      lobby.players.has(meta.prev) &&
      !this.rejoins.protectedId(meta.prev) &&
      lobby.migrationPeers?.delete(meta.prev)
    ) {
      restoredTeam = lobby.players.get(meta.prev)?.team ?? scores.get(meta.prev)?.team;
      this.replace(meta.prev, id);
    }
    const team = lobby.mode === 'teams' ? (restoredTeam ?? this.assignTeam()) : undefined;
    lobby.players.set(id, {
      name,
      color,
      ...(team ? { team } : {}),
    });
    this.add(id, name, team ? teamColor(team) : color);
    const publishTogether = !!this.rejoins.match && this.activeMatch();
    if (!publishTogether) this.broadcast();
    if (this.activeMatch()) {
      if (!scores.has(id))
        scores.set(id, {
          name,
          kills: 0,
          deaths: 0,
          ...(lobby.players.get(id)?.team ? { team: lobby.players.get(id)!.team } : {}),
        });
      if (!previous) this.offerRejoin(id);
      if (publishTogether) this.broadcast();
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
    const { lobby, transport, peers, inMatch, scores, refreshScores, render, feed } = this.ports;
    lobby.mode = data.mode ?? 'ffa';
    lobby.teamBank = data.teamBank ? { ...data.teamBank } : undefined;
    this.rejoins.receive(data.rejoins);
    lobby.hostId = data.hostId;
    lobby.isPublic = !!data.isPublic;
    lobby.code = transport.code || '';
    lobby.shown = data.shown || transport.code;
    if (data.map) lobby.map = knownMap(data.map);
    lobby.mapLocked = data.mapLocked === true;
    lobby.duration = data.duration ?? FFA_TIME;
    lobby.order = data.players.map((player) => player.id);
    lobby.players.clear();
    for (const { id, name, color: selection, team } of data.players) {
      const color = characterColor(selection);
      lobby.players.set(id, { name, color, ...(team ? { team } : {}) });
      if (id !== transport.id) {
        const peer = this.add(id, name, lobby.mode === 'teams' && team ? teamColor(team) : color);
        peer.setTeamLabel?.(lobby.mode === 'teams' ? team : undefined);
      }
    }
    const departed: string[] = [];
    for (const [id, peer] of peers) {
      if (lobby.players.has(id)) continue;
      if (this.leaveHints.has(id)) departed.push(peer.name);
      this.remove(id);
    }
    this.leaveHints.clear();
    if (data.rejoins) {
      scores.clear();
      for (const { id, name, kills, deaths, team } of data.rejoins.scores)
        scores.set(id, { name, kills, deaths, ...(team ? { team } : {}) });
    }
    if (inMatch()) {
      for (const player of data.players)
        if (!scores.has(player.id))
          scores.set(player.id, {
            name: player.name,
            kills: 0,
            deaths: 0,
            ...(player.team ? { team: player.team } : {}),
          });
      refreshScores();
      for (const name of departed) feed(name + ' left');
    }
    render();
  }
  leave(id: string) {
    const { lobby, inMatch, feed, render } = this.ports;
    const name = lobby.players.get(id)?.name;
    if (lobby.mode === 'teams' && inMatch()) {
      // A bare leave is only a feed hint; the lobby packet commits membership and teamBank.
      if (lobby.players.has(id)) this.leaveHints.add(id);
      return;
    }
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
