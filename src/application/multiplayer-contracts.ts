import type { Vector3 } from 'three';
import type { MapKey } from '../domain/maps.js';
import type { Score, ScoreRow, Winner } from '../domain/match.js';
import type { GamePayloads } from '../network/game-message-types.js';
import type { RemoteDamageTarget, RemoteServices } from '../gameplay/remote/services.js';
import type { Breakable } from '../gameplay/combat/props.js';
import type { CombatMessagePorts, CombatMessagePeer } from './combat-messages.js';
import type {
  NetworkCombatFeedbackPorts,
  ShotActor,
} from '../presentation/network-combat-feedback.js';
import type { ReplicatedPeer, NetworkSyncPorts } from './network-sync.js';
import type { MatchClockPorts } from './match-clock.js';
import type { RosterPeer } from './remote-roster.js';
import type { LobbyTransport, LobbyState, LobbyConnectionPorts } from './lobby-contracts.js';
import type { Pickup } from './pickup-contracts.js';

export type MultiplayerPeer = RosterPeer &
  ReplicatedPeer &
  CombatMessagePeer &
  ShotActor & {
    readonly idle: boolean;
    readonly idleSince: number;
    lastSeen: number;
    push(snapshot: readonly number[], time: number): void;
    onDamage: ((target: RemoteDamageTarget, amount: number, from: Vector3 | null) => void) | null;
  };
export interface MultiplayerTransport extends LobbyTransport {
  readonly active: boolean;
  readonly isHost: boolean;
  readonly hostId: string | null;
  readonly aliasCode?: string | null;
  readonly conns: Map<string, { close(): void }>;
  hostName: string;
  onPeerJoin: ((id: string, metadata: unknown) => void) | null;
  onPeerLeave: ((id: string) => void) | null;
  onDisconnect: (() => void) | null;
  on<K extends keyof GamePayloads>(
    kind: K,
    callback: (data: GamePayloads[K], sender: string) => void,
  ): void;
  onHost<K extends keyof GamePayloads>(
    kind: K,
    callback: (data: GamePayloads[K], sender: string) => void,
  ): void;
  send<K extends keyof GamePayloads>(kind: K, data: GamePayloads[K], relay?: boolean): void;
  sendTo<K extends keyof GamePayloads>(id: string, kind: K, data: GamePayloads[K]): void;
  broadcast<K extends keyof GamePayloads>(kind: K, data: GamePayloads[K]): void;
}
export interface MultiplayerPorts {
  remote: Map<string, MultiplayerPeer>;
  remoteServices: RemoteServices;
  net: MultiplayerTransport;
  lobby: LobbyState;
  scores: Map<string, Score>;
  local: MatchClockPorts['state'] & {
    myName: string;
    mapKey: MapKey;
    readonly pickups: readonly Pickup[];
    readonly level: { readonly breakables: readonly Breakable[] };
  };
  game: CombatMessagePorts['game'] & MatchClockPorts['game'];
  player: CombatMessagePorts['player'] &
    NetworkSyncPorts['player'] &
    NetworkCombatFeedbackPorts['player'] & {
      onFall: (() => void) | null;
    };
  input: NetworkCombatFeedbackPorts['input'] & { readonly idleSeconds: number };
  effects: NetworkCombatFeedbackPorts['effects'];
  audio: NetworkCombatFeedbackPorts['audio'] & {
    enemyDie(point: Vector3): void;
    kill(strong: boolean): void;
    empty(): void;
  };
  hud: NetworkCombatFeedbackPorts['hud'] & {
    hitmarker(kill: boolean, critical: boolean): void;
    setTimer(text: string): void;
    message(title: string, detail: string, duration: number): void;
  };
  shotQueue: number[];
  inMatch(): boolean;
  online(): boolean;
  canHurt(target: RemoteDamageTarget): boolean;
}
export interface MultiplayerActions {
  renderLobby(): void;
  sendScores(): void;
  refreshScoreHud(): void;
  farthestSpawnIndex(): number;
  startMatch(late: boolean, spawn?: number, clock?: GamePayloads['clock']): void;
  breakProp(prop: Breakable, direction: Vector3 | null, local: boolean, quiet?: boolean): void;
  hostStart(): void;
  endMatch(winner: Winner): void;
  toLobbyScreen(): void;
  spawnPickup(kind: 'ammo' | 'health', point: Vector3, id: number): void;
  removePickup(pickup: Pickup): void;
  tallyDeath(victim: string, killer?: string | null): void;
  applyScores(rows: ScoreRow[]): void;
  sortedScores(): Array<[string, Score]>;
  session: LobbyConnectionPorts['session'];
  connectionPresentation: LobbyConnectionPorts['presentation'] & { start(): void };
}
