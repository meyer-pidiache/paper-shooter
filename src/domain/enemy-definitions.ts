/** Immutable-in-practice archetype recipes; changing values is game balance, separate from refactoring. */
interface EnemyBase {
  hp: number;
  speed: number;
  dmg: number;
  score: number;
  scale: number;
  name: string;
  ink?: number;
  hat?: 'band' | 'helmet' | 'hood' | 'crown';
  model?: 'bomber' | 'blob' | 'flyer';
  flying?: boolean;
  boss?: boolean;
  shield?: boolean;
  build?: { bodyW?: number; headS?: number; limbR?: number };
}
interface GroundGun extends EnemyBase {
  range: number;
  stop: number;
  keep: number;
  cool: [number, number];
  spread: number;
  pspeed: number;
  stationary?: boolean;
}
export interface BurstEnemyDefinition extends GroundGun {
  weapon: 'rifle' | 'pistol';
  burst: number;
  burstInt: number;
}
export interface ShotgunEnemyDefinition extends GroundGun {
  weapon: 'shotgun';
  pellets: number;
}
export interface SniperEnemyDefinition extends GroundGun {
  weapon: 'sniper';
  aimTime: number;
}
export type RangedEnemyDefinition =
  BurstEnemyDefinition | ShotgunEnemyDefinition | SniperEnemyDefinition;
export interface BladeEnemyDefinition extends EnemyBase {
  weapon: 'blade';
  lunge: number;
  reach: number;
  standoff: number;
  cool: [number, number];
}
export interface BomberEnemyDefinition extends EnemyBase {
  weapon: 'bomb';
  fuseRange: number;
  fuse: number;
  blast: number;
}
export interface FlyingEnemyDefinition extends EnemyBase {
  weapon: 'dive';
  cool: [number, number];
}
export interface BossEnemyDefinition extends EnemyBase {
  weapon: 'boss';
  bossKind: 'doodler' | 'eraser' | 'inkblot';
  range: number;
  stop: number;
  keep: number;
  cool: [number, number];
}
export type EnemyDefinition =
  | RangedEnemyDefinition
  | BladeEnemyDefinition
  | BomberEnemyDefinition
  | FlyingEnemyDefinition
  | BossEnemyDefinition;
