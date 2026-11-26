import type { Vector3 } from 'three';
import type { Score } from '../domain/match.js';
import type { PlayerHitReceipt } from '../gameplay/player/services.js';
import type { GamePayloads } from '../network/game-message-types.js';
import type { Winner } from './session-contracts.js';
import type { KillFeedEntry } from '../presentation/kill-feed.js';
import type { CharacterColor } from '../shared/character-color.js';
import type { MapKey } from '../domain/maps.js';

export interface MatchOpponent {
  readonly alive: boolean;
  readonly root: { visible: boolean } | null;
  readonly body: { pos: Vector3 };
}
export interface MatchPlayer {
  readonly alive: boolean;
  readonly body: { pos: Vector3 };
  readonly center: Vector3;
  name: string;
  lastHitBy: string | null;
  lastHit: PlayerHitReceipt | null;
  shieldT: number;
  reset(point: Vector3): void;
}
export interface MatchTransport {
  readonly id: string | null;
  readonly isHost: boolean;
  readonly active: boolean;
  send<K extends 'score' | 'end'>(kind: K, data: GamePayloads[K]): void;
  broadcast(kind: 'pdead', data: GamePayloads['pdead']): void;
}
export interface MatchHud {
  kill(message: KillFeedEntry, points: number): void;
  tip(message: string, duration: number): void;
  setPvpScore(html: string): void;
  setPauseScores(html: string): void;
  setModifier(html: string): void;
  setBoard(html: string | null): void;
  setGameplayVisible(visible: boolean): void;
  showScreen(html: string): void;
  setTimer(text: string): void;
  bindResultsReturn(onReturn: () => void): void;
}
export interface MatchPorts {
  player: MatchPlayer;
  opponents(): Iterable<MatchOpponent>;
  level(): { arenaSpawns?: readonly Vector3[]; spawns: readonly Vector3[] };
  online(): boolean;
  finished(): boolean;
  localName(): string;
  colorFor(id: string): CharacterColor | undefined;
  remainingTime(): number;
  lobbyCode(): string;
  boardVisible(): boolean;
  transport: MatchTransport;
  scores: Map<string, Score>;
  hud: MatchHud;
  bindMapVote(onVote: (map: MapKey) => void): void;
  spawnFeedback(point: Vector3): void;
  exitLock(): void;
  endFocus(): void;
  session: {
    playerDied(): void;
    playerRespawned(): void;
    finishMatch(winner: Winner, voteId?: number): void;
    castMapVote(map: MapKey): void;
    returnFromResults(): void;
  };
}
