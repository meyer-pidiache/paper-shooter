import type { Vector3 } from 'three';
import type { GamePhase } from '../domain/match.js';
export interface FrameScheduling {
  now(): number;
  request(callback: (time: number) => void): number;
  cancel(id: number): void;
  background(callback: () => void, milliseconds: number): () => void;
}
export interface LoopPorts {
  game: {
    readonly state: GamePhase;
    time: number;
    hitstopT: number;
    readonly hitstopScale: number;
    readonly focus: { readonly active: boolean };
    comboT: number;
    combo: number;
    readonly score: number;
  };
  player: {
    body: { pos: Vector3 };
    shieldT: number;
    update(dt: number): void;
    idleCam(time: number): void;
  };
  input: { readonly anyInput: boolean; update(dt: number): void };
  enemies: { update(dt: number): void };
  effects: { update(dt: number): void };
  hud: {
    setScore(points: number, combo: number): void;
    setNerdStats?(fps: number | null, ping: number | null, label: string): void;
  };
  net: {
    readonly active: boolean;
  };
  audio: { readonly musicPlaying: boolean; musicOn(playing: boolean): void; resume(): void };
  musicWanted(): boolean;
  audioReady(): boolean;
  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number };
  online(): boolean;
  interaction: { update(phase: GamePhase, playing: boolean, dt: number): void };
  presentation: { present(playing: boolean, dt: number, scale: number): void };
  scheduling: FrameScheduling;
  stats?: {
    enabled(): boolean;
    ping(): { value: number | null; label: string };
  };
  actions: {
    updateFocus(dt: number): void;
    endFocus(): void;
    updatePickups(dt: number): void;
    netUpdate(dt: number, clockElapsed?: number): void;
    updateWaves(dt: number): void;
    updateArenaPickups(dt: number): void;
    updateDeath(phase: GamePhase, dt: number): void;
    updateResults(elapsed: number): void;
  };
}
