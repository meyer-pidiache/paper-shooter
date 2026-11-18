import { Vector3, type Object3D } from 'three';
export interface AnimationFrame {
  velocity: Vector3;
  center: Vector3;
  onGround: boolean;
  yaw: number;
  time: number;
  fuseT: number;
  aimAmt: number;
  attackT: number;
  flinch: number;
  state: string;
  flyState: string;
  bossAtk: { kind: string; t: number } | null;
}
export interface WalkingAppearance {
  weapon: string;
  model?: string;
  shield?: boolean;
}
export interface WalkingJoints {
  hips: Object3D;
  torso: Object3D;
  headG: Object3D;
  armL: Object3D;
  armR: Object3D;
  foreL: Object3D;
  foreR: Object3D;
  legL: Object3D;
  legR: Object3D;
  shinL: Object3D;
  shinR: Object3D;
  gun: Object3D;
  spark?: Object3D | null;
}
export interface FlyingJoints {
  body: Object3D;
  wl: Object3D;
  wr: Object3D;
}
export function animationFrame(velocity: Vector3, center: Vector3): AnimationFrame {
  return {
    velocity,
    center,
    onGround: false,
    yaw: 0,
    time: 0,
    fuseT: -1,
    aimAmt: 0,
    attackT: 0,
    flinch: 0,
    state: 'spawn',
    flyState: 'orbit',
    bossAtk: null,
  };
}
