import type { SavedPreferences } from '../platform/preferences.js';
import type { MapKey } from '../domain/maps.js';
import type { Level } from '../maps/index.js';
import type { NavGrid } from '../engine/navigation.js';
import type { FocusState } from '../gameplay/focus/contracts.js';
import type { EnemyActor } from '../gameplay/enemies/actor.js';
import type { SessionGame } from './session-contracts.js';
import type { WaveState } from './wave-contracts.js';
import type { Pickup } from './pickup-contracts.js';
import type { KillFeedEntry } from '../presentation/kill-feed.js';
/** Owned construction state. Controllers continue to consume only their scoped protocols. */
export interface RuntimeState extends SavedPreferences {
  loadedKey: MapKey;
  arenaLoaded: boolean;
  matchLeft: number;
  clockT: number;
  clockRunning: boolean;
  screen: 'main' | 'online' | 'lobby';
  pickups: Pickup[];
  pickupClock: number;
  level: Level;
  nav: NavGrid;
}
export interface GameState extends SessionGame, WaveState {
  matchT: number;
  time: number;
  hitstopT: number;
  hitstopScale: number;
  score: number;
  combo: number;
  comboT: number;
  kills: number;
  katanaStreak: number;
  focus: FocusState<EnemyActor>;
  hitstop(duration: number, scale: number): void;
  addScore(points: number, label?: KillFeedEntry | null): void;
  onPlayerDeath(): void;
}
