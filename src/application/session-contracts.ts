import type { Vector3 } from 'three';
import type { EnemyKind } from '../domain/enemies.js';
import type { MatchStart } from '../network/game-message-types.js';
import type { LobbyState } from './lobby-contracts.js';
import type { MapKey } from '../domain/maps.js';
import type { Score, Winner, GamePhase } from '../domain/match.js';
import type { DeathState, DeathInput } from './death-progress.js';
export type { Winner, GamePhase } from '../domain/match.js';

export interface SessionGame extends DeathState {
  state: GamePhase;
  mode: 'solo' | 'ffa';
  menu: boolean;
  over: Winner | null;
  clockStarted: boolean;
  overT: number;
}
export interface SessionScreen {
  screen: 'main' | 'online' | 'lobby';
  myName: string;
  mapKey: MapKey;
  musicWanted: boolean;
  matchLeft: number;
  clockT: number;
  clockRunning: boolean;
}
export interface SessionInput extends DeathInput {
  readonly usingGamepad: boolean;
  readonly pointerLocked: boolean;
  pressed(action: 'pause' | 'jump' | 'confirm'): boolean;
  down(action: 'pause' | 'jump' | 'confirm'): boolean;
  requestLock(): void;
  exitLock(): void;
}
export interface SessionAudio {
  readonly musicPlaying: boolean;
  init(): void;
  resume(): void;
  musicOn(playing: boolean): void;
  reelLoop(playing: boolean): void;
}
export interface SessionHud {
  hideScreen(): void;
  setGameplayVisible(visible: boolean): void;
  setBoard(html: string | null): void;
  enableResultsReturn(): void;
  message(title: string, detail: string, duration: number): void;
  tip(html: string, duration: number): void;
  key(action: string): string;
}
export interface SessionPresentation {
  start(): void;
  pause(): void;
  clickToPlay(): void;
  dead(): void;
}
export interface SessionTransport {
  readonly id: string | null;
  readonly isHost: boolean;
  readonly active: boolean;
  inMatch: boolean;
  send(type: 'backtolobby', data: Record<string, never>): void;
  send(type: 'start', data: MatchStart): void;
}
export interface SessionPorts {
  game: SessionGame;
  screen: SessionScreen;
  input: SessionInput;
  audio: SessionAudio;
  hud: SessionHud;
  presentation: SessionPresentation;
  transport: SessionTransport;
  lobby: Pick<LobbyState, 'players' | 'map' | 'duration'>;
  scores: Map<string, Score>;
  player: { reset(position: Vector3): void; shieldT: number };
  remote: () => Iterable<{ lastSeen: number }>;
  setArena(arena: boolean): void;
  resetRun(): void;
  clearWave(): void;
  startWave(wave: number): void;
  spawnSpots(): readonly Vector3[];
  arenaSpawn(): Vector3;
  sendScores(): void;
  prepareRejoins(): void;
  clearRejoins(): void;
  refreshScores(): void;
  respawnLocal(): void;
}
export interface RunGame {
  boss: { alive: boolean } | null;
  katanaStreak: number;
  score: number;
  kills: number;
  combo: number;
  wave: number;
  intermission: number;
  queue: EnemyKind[];
  time: number;
  over: Winner | null;
  matchT: number;
}
