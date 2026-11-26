import type { Scene, Vector3 } from 'three';
import type { SceneResourcePort } from '../engine/ports.js';
import type { GamePayloads } from '../network/game-message-types.js';
import type { PvpDamagePorts, PvpOpponent } from '../gameplay/combat/pvp-damage.js';
import type { PlayerQueryTarget } from '../gameplay/combat/player-queries.js';
import type { RopeTarget } from '../gameplay/combat/rope-cuts.js';
import type { GrenadeBlastPorts, SplashTarget } from '../gameplay/combat/grenade-blast.js';
import type { Breakable, PropCombatPorts } from '../gameplay/combat/props.js';
import type { PropEffects } from '../presentation/prop-feedback.js';
export interface CombatOpponent extends PvpOpponent, PlayerQueryTarget, RopeTarget, SplashTarget {}
export type CombatLocalPlayer = PvpDamagePorts<CombatOpponent>['local'] &
  GrenadeBlastPorts['local'] & {
    grenadeSystem: { onExplosion: ((point: Vector3, mine: boolean) => void) | null };
  };
interface CombatTransport {
  readonly id: string | null;
  readonly active: boolean;
  readonly isHost: boolean;
  sendTo<K extends 'parry' | 'pdmg' | 'cut'>(peer: string, kind: K, data: GamePayloads[K]): void;
  broadcast(kind: 'brk', data: GamePayloads['brk']): void;
}
export interface CombatPorts {
  player: CombatLocalPlayer;
  remote: ReadonlyMap<string, CombatOpponent>;
  targets(): Iterable<SplashTarget>;
  props(): readonly Breakable[];
  lookupProp(id: number): Breakable | undefined;
  canAttack?(id: string): boolean;
  online(): boolean;
  solo(): boolean;
  inMatch(): boolean;
  world: PropCombatPorts['world'] & { hasLineOfSight(from: Vector3, to: Vector3): boolean };
  scene: Scene;
  resources: SceneResourcePort;
  effects: PvpDamagePorts<CombatOpponent>['effects'] &
    PropEffects & { boom(point: Vector3, radius: number): void };
  audio: PvpDamagePorts<CombatOpponent>['audio'] & {
    explosion(point: Vector3): void;
    smash(point: Vector3, heavy: boolean): void;
  };
  hud: PvpDamagePorts<CombatOpponent>['hud'];
  input: { rumble(strong: number, weak: number, milliseconds: number): void };
  net: CombatTransport;
  hitstop(duration: number, scale: number): void;
  score(points: number, label: string): void;
  postponeMelee(duration: number): void;
  blastEnemies(point: Vector3, radius: number, damage: number): void;
  shotQueue: number[];
}
export interface CombatActions {
  spawnPickup(kind: 'health', point: Vector3): void;
}
