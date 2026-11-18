import { Euler, Quaternion, Vector3, type Object3D } from 'three';
import { clamp, damp } from '../../engine/math.js';
import type { WalkingJoints } from './animation-contracts.js';
export interface RemoteAnimationFrame {
  velocity: Vector3;
  position: Vector3;
  onGround: boolean;
  alive: boolean;
  blade: boolean;
  aiming: boolean;
  blocking: boolean;
  pitch: number;
  sliding: boolean;
  crouching: boolean;
  localEye: Vector3 | null;
}
export interface RemoteAnimationRig {
  root: Object3D;
  joints: WalkingJoints & { gun: Object3D };
  tag: Object3D;
  face: { eyes: Object3D; xeyes: Object3D } | null;
}
export function remoteAnimationFrame(velocity: Vector3, position: Vector3): RemoteAnimationFrame {
  return {
    velocity,
    position,
    onGround: true,
    alive: true,
    blade: false,
    aiming: false,
    blocking: false,
    pitch: 0,
    sliding: false,
    crouching: false,
    localEye: null,
  };
}
/** Owns remote gait and joint poses; model replacement does not reset the gait clock. */
export class RemoteAnimation {
  private walk = 0;
  private phase = 0;
  private aim = 0;
  private readonly grip = new Vector3();
  private readonly support = new Vector3();
  private readonly weaponAngles = new Euler(0, 0, 0, 'YXZ');
  private readonly weaponRotation = new Quaternion();
  private readonly inverse = new Quaternion();
  private readonly down = new Vector3(0, -1, 0);
  private readonly reach = new Vector3();
  private readonly elbow = new Vector3();
  private readonly direction = new Vector3();

  resetAim(aiming: boolean) {
    this.aim = Number(aiming);
  }

  private poseArm(arm: Object3D, forearm: Object3D, target: Vector3, elbowSide: number) {
    const upper = -forearm.position.y;
    const lower = 0.3;
    const reach = this.reach.subVectors(target, arm.position);
    const distance = clamp(reach.length(), 0.01, upper + lower - 0.001);
    reach.normalize();
    const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
    // Bend down and out from the body in the plane perpendicular to the reach.
    const elbow = this.elbow.set(elbowSide, -1, 0);
    elbow
      .addScaledVector(reach, -elbow.dot(reach))
      .normalize()
      .multiplyScalar(Math.sqrt(upper * upper - along * along))
      .addScaledVector(reach, along);
    arm.quaternion.setFromUnitVectors(this.down, this.direction.copy(elbow).normalize());
    reach
      .multiplyScalar(distance)
      .sub(elbow)
      .normalize()
      .applyQuaternion(this.inverse.copy(arm.quaternion).invert());
    forearm.quaternion.setFromUnitVectors(this.down, reach);
  }

  private poseGun(J: RemoteAnimationRig['joints'], pitch: number, sway: number) {
    const aim = this.aim;
    this.grip.set(0.14 - 0.03 * aim, 0.23 + 0.26 * aim, 0.26 + 0.01 * aim);
    this.weaponAngles.set(-pitch + (0.48 + sway) * (1 - aim), -0.38 * (1 - aim), 0);
    // Express the look direction in torso space so crouching and gait keep their own motion.
    this.weaponRotation
      .setFromEuler(this.weaponAngles)
      .premultiply(this.inverse.copy(J.torso.quaternion).invert());
    // Support the receiver, within reach even when the muzzle is lowered.
    this.support.set(-0.035, 0.06, 0.16).applyQuaternion(this.weaponRotation).add(this.grip);
    this.poseArm(J.armR, J.foreR, this.grip, 0.75);
    this.poseArm(J.armL, J.foreL, this.support, -0.75);
    this.orientHeldWeapon(J);
  }

  private orientHeldWeapon(J: RemoteAnimationRig['joints']) {
    J.gun.quaternion
      .copy(J.armR.quaternion)
      .multiply(J.foreR.quaternion)
      .invert()
      .multiply(this.weaponRotation);
  }

  update(frame: RemoteAnimationFrame, rig: RemoteAnimationRig, dt: number) {
    const J = rig.joints;
    const sp = Math.hypot(frame.velocity.x, frame.velocity.z);
    this.walk = damp(this.walk, clamp(sp / 4, 0, 1), 10, dt);
    const w = this.walk;
    this.phase += dt * (sp * 2.2 + (sp > 0.4 ? 3 : 0));
    const s = Math.sin(this.phase),
      c = Math.cos(this.phase);
    if (!frame.alive) {
      // slumped on the page until they respawn
      rig.root.rotation.x = damp(rig.root.rotation.x, Math.PI / 2, 5, dt);
      if (rig.face) {
        rig.face.eyes.visible = false;
        rig.face.xeyes.visible = true;
      }
      return;
    }
    rig.root.rotation.x = damp(rig.root.rotation.x, 0, 8, dt);
    if (rig.face) {
      rig.face.eyes.visible = true;
      rig.face.xeyes.visible = false;
    }
    J.legL.rotation.x = s * 0.9 * w;
    J.legR.rotation.x = -s * 0.9 * w;
    J.shinL.rotation.x = Math.max(0, c) * 1.1 * w;
    J.shinR.rotation.x = Math.max(0, -c) * 1.1 * w;
    if (!frame.onGround) {
      J.legL.rotation.x = -0.5;
      J.legR.rotation.x = 0.6;
      J.shinL.rotation.x = 1.0;
      J.shinR.rotation.x = 0.5;
    }
    this.aim = frame.blade ? 0 : damp(this.aim, Number(frame.aiming), 18, dt);
    J.torso.rotation.x = -0.2 * w + (frame.sliding ? 0.5 : 0) + (frame.crouching ? 0.25 : 0);
    J.torso.rotation.y = frame.blade ? 0 : -0.14 - 0.16 * this.aim;
    J.gun.position.set(0, -0.3, 0);
    if (frame.blade) {
      const g = frame.blocking ? 1 : 0;
      J.armR.rotation.set(-0.9 - g * 0.9 - s * 0.6 * w * (1 - g), 0, -0.3 - g * 0.5);
      J.foreR.rotation.set(-1.0 - g * 0.6, 0, 0);
      J.armL.rotation.set(s * 0.8 * w * (1 - g) - g * 1.4, 0, 0);
      J.foreL.rotation.set(-0.5, 0, 0);
      if (frame.blocking) {
        this.weaponRotation.setFromEuler(this.weaponAngles.set(-1.2, -0.65, 0));
        this.orientHeldWeapon(J);
      } else {
        J.gun.rotation.set(0, 0, 0);
      }
    } else {
      this.poseGun(J, frame.pitch, s * 0.1 * w);
    }
    J.hips.position.y = (frame.crouching ? 0.55 : 0.86) + Math.abs(c) * 0.07 * w;
    J.headG.rotation.x = clamp(-frame.pitch, -0.7, 0.7) * 0.7;
    const localEye = frame.localEye;
    rig.tag.rotation.y =
      -rig.root.rotation.y +
      (localEye ? Math.atan2(localEye.x - frame.position.x, localEye.z - frame.position.z) : 0);
  }
}
