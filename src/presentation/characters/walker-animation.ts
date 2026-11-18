import { Vector3 } from 'three';
import { clamp, damp, wrapAngle } from '../../engine/math.js';
import { HeldWeaponPose } from './held-weapon-pose.js';
import type { AnimationFrame, WalkingJoints, WalkingAppearance } from './animation-contracts.js';
/** Owns gait/phase and joint poses; consumes a numeric borrowed frame, never an actor. */
export class WalkerAnimation {
  private walk = 0;
  private readonly look = new Vector3();
  private readonly weaponPose = new HeldWeaponPose();
  constructor(
    private readonly appearance: WalkingAppearance,
    private readonly joints: WalkingJoints,
    private phase: number,
  ) {}
  update(e: AnimationFrame, dt: number, pc: Vector3) {
    const J = this.joints,
      T = this.appearance;
    const sp = Math.hypot(e.velocity.x, e.velocity.z);
    this.walk = damp(this.walk, clamp(sp / 4, 0, 1), 10, dt);
    const w = this.walk;
    this.phase += dt * (sp * 2.2 + (sp > 0.4 ? 3 : 0));
    const s = Math.sin(this.phase),
      c = Math.cos(this.phase);
    J.legL.rotation.x = s * 0.9 * w;
    J.legR.rotation.x = -s * 0.9 * w;
    J.shinL.rotation.x = Math.max(0, c) * 1.1 * w;
    J.shinR.rotation.x = Math.max(0, -c) * 1.1 * w;
    if (!e.onGround) {
      J.legL.rotation.x = -0.5;
      J.legR.rotation.x = 0.6;
      J.shinL.rotation.x = 1.0;
      J.shinR.rotation.x = 0.5;
    }

    if (T.weapon === 'bomb' || T.model === 'blob') {
      this.blob(e, w, c);
      return;
    }
    this.look.subVectors(pc, e.center);
    const lookYaw = wrapAngle(Math.atan2(this.look.x, this.look.z) - e.yaw);
    const lookPitch = Math.atan2(this.look.y, Math.hypot(this.look.x, this.look.z));
    if (T.weapon === 'blade') this.blade(e, w, s);
    else if (T.weapon === 'boss') this.boss(e, w, s);
    else this.ranged(e, w, s, lookPitch, lookYaw);
    J.hips.position.y = 0.86 + Math.abs(c) * 0.07 * w + (e.onGround ? 0 : -0.05);
    J.headG.rotation.y = clamp(wrapAngle(lookYaw - (J.torso.rotation.y || 0)), -1.1, 1.1);
    J.headG.rotation.x = clamp(-lookPitch, -0.6, 0.6) * 0.8;
    J.headG.rotation.z = Math.sin(this.phase * 0.5) * 0.06 * w;
    if (e.state === 'stunned') {
      J.torso.rotation.x = 0.6;
      J.armL.rotation.x = -2.5;
      J.armR.rotation.x = -2.5;
      J.legL.rotation.x = -0.8;
      J.legR.rotation.x = 0.9;
    }
  }
  private blob(e: AnimationFrame, w: number, c: number) {
    const J = this.joints;
    J.armL.rotation.x = -2.4 + Math.sin(e.time * 20) * 0.4 * w;
    J.armR.rotation.x = -2.4 - Math.sin(e.time * 20) * 0.4 * w;
    J.torso.rotation.z = Math.sin(this.phase) * 0.12 * w;
    J.torso.rotation.x = -0.15 * w;
    if (J.spark) J.spark.scale.setScalar(0.7 + Math.random() * 0.8 + (e.fuseT >= 0 ? 1.5 : 0));
    J.hips.position.y = 0.5 + Math.abs(c) * 0.08 * w;
    if (e.fuseT >= 0) {
      J.torso.rotation.x = Math.sin(e.time * 40) * 0.15;
      J.headG.rotation.y = Math.sin(e.time * 30) * 0.3;
    }
    return;
  }
  private blade(e: AnimationFrame, w: number, s: number) {
    const J = this.joints;
    const at = e.attackT;
    const wind = at > 0.18 ? clamp((0.55 - at) / 0.37, 0, 1) : 0;
    const strike = at > 0 && at <= 0.18 ? 1 - at / 0.18 : 0;
    J.armR.rotation.x = -0.8 * (1 - w) - s * 0.9 * w - wind * 2.2 + strike * 1.5;
    J.armR.rotation.z = -0.3 + wind * 0.7 - strike * 0.5;
    J.foreR.rotation.x = -0.9 - wind * 0.7 + strike * 0.5;
    J.armL.rotation.x = s * 1.1 * w - wind * 0.5;
    J.armL.rotation.z = 0.35 * w;
    J.foreL.rotation.x = -0.6 * w;
    J.torso.rotation.x = -0.3 * w + e.flinch * 0.35 - wind * 0.25 + strike * 0.55;
    J.torso.rotation.y = wind * 0.5 - strike * 0.6;
  }
  private boss(e: AnimationFrame, w: number, s: number) {
    const J = this.joints;
    const a = e.bossAtk;
    let raise = 0,
      slam = 0;
    if (a && a.kind === 'stomp') {
      raise = a.t < 0.75 ? clamp(a.t / 0.6, 0, 1) : 0;
      slam = a.t >= 0.75 ? 1 : 0;
    }
    if (a && a.kind === 'throw') {
      raise = a.t < 0.6 ? clamp(a.t / 0.5, 0, 1) : 0;
    }
    J.armR.rotation.x = -0.4 - s * 0.5 * w - raise * 2.4 + slam * 0.9;
    J.armR.rotation.z = -0.35;
    J.foreR.rotation.x = -0.6 - raise * 0.4;
    J.armL.rotation.x = s * 0.6 * w - raise * 0.8;
    J.armL.rotation.z = 0.35;
    J.foreL.rotation.x = -0.5;
    J.torso.rotation.x = -0.1 * w + e.flinch * 0.15 - raise * 0.3 + slam * 0.5;
  }
  private ranged(e: AnimationFrame, w: number, s: number, pitch: number, yaw: number) {
    const J = this.joints;
    const aim = clamp(e.aimAmt, 0, 1);
    J.torso.rotation.x = -0.22 * w + e.flinch * 0.4;
    J.torso.rotation.y = -0.35 * aim;
    J.torso.rotation.z = Math.sin(this.phase) * 0.05 * w;
    if (this.appearance.shield) {
      J.armL.rotation.set(-1.2, 0.3, 0);
      J.foreL.rotation.set(-0.9, 0, 0);
    }
    this.weaponPose.poseGun(
      J,
      aim,
      (pitch - e.flinch * 0.35) * aim,
      clamp(yaw, -0.65, 0.65) * aim,
      s * 0.1 * w,
      !this.appearance.shield,
    );
  }
}
