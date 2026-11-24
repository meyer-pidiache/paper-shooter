import type { Scene, PerspectiveCamera } from 'three';
import type { SceneResourcePort } from '../../engine/ports.js';
import type { MovementEnvironment, MovementInput } from './movement-contracts.js';
import type { GrappleWorldPort, GrappleQueries } from './grapple-contracts.js';
import type { PlayerFeedbackPorts } from './feedback-contracts.js';
import type { GunServices, BladeServices } from '../weapons/services.js';
export interface PlayerInput extends MovementInput {
  readonly look: { x: number; y: number };
}
export interface PlayerPresentation extends PlayerFeedbackPorts {
  audio: PlayerFeedbackPorts['audio'] & { footstep(gain: number): void; switchWeapon(): void };
  hud: PlayerFeedbackPorts['hud'] & {
    setWeapon(name: string, hint: string): void;
    setCrosshairMode(mode: string): void;
    setAds(visible: boolean): void;
    setScope(visible: boolean): void;
  };
  effects: PlayerFeedbackPorts['effects'] & { sampleShake(dt: number): number };
}
export interface PlayerServices {
  environment: MovementEnvironment & {
    scene: Scene;
    camera: PerspectiveCamera;
    resources: SceneResourcePort;
    world: GrappleWorldPort;
  };
  input: PlayerInput;
  feedback: PlayerPresentation;
  weapons: { gun: GunServices; blade: BladeServices };
  grappleQueries: GrappleQueries;
  died(): void;
}
export interface PlayerHitReceipt {
  from?: number[] | null;
  crit?: boolean;
  amount?: number;
  src?: string;
}
