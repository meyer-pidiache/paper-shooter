import { Euler, Quaternion, Vector3, type Object3D } from 'three';
import { clamp } from '../../engine/math.js';
import type { WalkingJoints } from './animation-contracts.js';

/** Places a humanoid's hands and weapon in torso space. */
export class HeldWeaponPose {
  private readonly grip = new Vector3();
  private readonly support = new Vector3();
  private readonly weaponAngles = new Euler(0, 0, 0, 'YXZ');
  private readonly weaponRotation = new Quaternion();
  private readonly inverse = new Quaternion();
  private readonly down = new Vector3(0, -1, 0);
  private readonly reach = new Vector3();
  private readonly elbow = new Vector3();
  private readonly direction = new Vector3();

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

  poseGun(
    J: WalkingJoints,
    aim: number,
    pitch: number,
    yaw: number,
    sway: number,
    twoHanded = true,
  ) {
    // A wider shoulder span needs a slightly closer grip to reach across the receiver.
    const excessWidth = twoHanded ? Math.max(0, J.armR.position.x - 0.26) : 0;
    const gripX = twoHanded ? 0.14 - 0.03 * aim - 0.6 * excessWidth : J.armR.position.x + 0.05;
    this.grip.set(gripX, 0.23 + 0.26 * aim, 0.26 + 0.01 * aim - 0.3 * excessWidth);
    this.weaponAngles.set(-pitch + (0.48 + sway) * (1 - aim), yaw - 0.38 * (1 - aim), 0);
    // Express the look direction in torso space so crouching and gait keep their own motion.
    this.weaponRotation
      .setFromEuler(this.weaponAngles)
      .premultiply(this.inverse.copy(J.torso.quaternion).invert());
    // Support the receiver, within reach even when the muzzle is lowered.
    this.poseArm(J.armR, J.foreR, this.grip, 0.75);
    if (twoHanded) {
      this.support.set(-0.035, 0.06, 0.16).applyQuaternion(this.weaponRotation).add(this.grip);
      this.poseArm(J.armL, J.foreL, this.support, -0.75);
    }
    this.orientHeldWeapon(J);
  }

  guard(J: WalkingJoints) {
    this.weaponRotation.setFromEuler(this.weaponAngles.set(-1.2, -0.65, 0));
    this.orientHeldWeapon(J);
  }

  private orientHeldWeapon(J: WalkingJoints) {
    J.gun.quaternion
      .copy(J.armR.quaternion)
      .multiply(J.foreR.quaternion)
      .invert()
      .multiply(this.weaponRotation);
  }
}
