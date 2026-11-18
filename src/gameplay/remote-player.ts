// Checked remote target/read model. Independent components own interpolation and presentation.
import * as THREE from 'three';
import type { RemoteServices, RemoteDamageTarget } from './remote/services.js';
import type {
  CharacterAppearance,
  CharacterPart,
} from '../presentation/models/character-contracts.js';
import type { RemoteAnimationRig } from '../presentation/characters/remote-animation.js';
import { RemoteRagdoll } from '../presentation/characters/remote-ragdoll.js';
import { RemoteGrapple } from '../presentation/remote-grapple.js';
import { RemoteInterpolation } from './remote/interpolation.js';
import { makeInkMaterial, setFill } from '../presentation/ink/materials.js';
import { INK } from '../shared/ink.js';
import { buildHumanoid } from '../presentation/models/humanoid.js';
import { buildHeldWeapon } from '../presentation/models/held-weapon.js';
import {
  RemoteAnimation,
  remoteAnimationFrame,
} from '../presentation/characters/remote-animation.js';

const _v = new THREE.Vector3();
const WEAPON_KINDS = ['rifle', 'shotgun', 'sniper', 'blade'] as const;
const HIT: [Exclude<CharacterPart, 'shield'>, number][] = [
  ['head', 0.3],
  ['torso', 0.33],
  ['hips', 0.2],
  ['armL', 0.11],
  ['armR', 0.11],
  ['foreL', 0.1],
  ['foreR', 0.1],
  ['legL', 0.13],
  ['legR', 0.13],
  ['shinL', 0.11],
  ['shinR', 0.11],
];

export { encodeLocal } from '../domain/player-snapshots.js';

type RemoteModel = ReturnType<typeof buildHumanoid> & {
  tagG: THREE.Group;
  animation: RemoteAnimationRig;
  weapon: THREE.Group;
};
export class RemotePlayer {
  name: string;
  readonly isLocal = false;
  alive = true;
  parryWindow = false;
  idle = false;
  idleSince = 0;
  untouched = false;
  away = false;
  hp = 100;
  maxHp = 100;
  speed = 0;
  weaponIndex = 0;
  readonly body = {
    pos: new THREE.Vector3(0, -50, 0),
    vel: new THREE.Vector3(),
    halfW: 0.35,
    height: 1.75,
    onGround: true,
  };
  readonly center = new THREE.Vector3();
  readonly eye = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, -1);
  readonly right = new THREE.Vector3(1, 0, 0);
  yaw = 0;
  pitch = 0;
  crouching = false;
  sliding = false;
  blocking = false;
  aiming = false;
  firing = false;
  private readonly animation = new RemoteAnimation();
  private readonly death: RemoteRagdoll;
  private readonly animationFrame = remoteAnimationFrame(this.body.vel, this.body.pos);
  private flashT = 0;
  deadT = 0;
  kills = 0;
  deaths = 0;
  score = 0;
  lastSeen = 0;
  readonly mat: THREE.ShaderMaterial;
  readonly solid: THREE.ShaderMaterial;
  private readonly sight: THREE.ShaderMaterial;
  private readonly releaseMaterials: () => void;
  readonly T: CharacterAppearance & { blockRadius: number } = {
    weapon: 'rifle',
    scale: 1.0,
    build: { bodyW: 1, headS: 1, limbR: 0.033 },
    blockRadius: 0,
  };
  readonly hit = HIT;
  readonly hitSpheres = HIT.map(() => new THREE.Vector3());
  readonly vel = new THREE.Vector3();
  private readonly deathPose = { center: this.center, position: this.body.pos, velocity: this.vel };
  private readonly interpolation = new RemoteInterpolation(this.body, this.vel);
  grappling = false;
  readonly gPoint = new THREE.Vector3();
  private readonly ropeView: RemoteGrapple;
  private model: RemoteModel;
  root: THREE.Group | null;
  private corpse = false;
  onDamage:
    ((target: RemoteDamageTarget, amount: number, from: THREE.Vector3 | null) => void) | null =
    null;
  constructor(
    private readonly services: RemoteServices,
    readonly id: string,
    name: string,
    readonly team: number,
    readonly ink: number,
  ) {
    this.name = name || 'paper';
    this.death = new RemoteRagdoll(services.scene, services.effects);
    this.mat = makeInkMaterial({ ink, shadeScale: 0, shadeBias: 1 });
    this.solid = makeInkMaterial({ ink: INK.BLACK, fill: true, side: THREE.DoubleSide });
    this.sight = makeInkMaterial({ ink: INK.RED, fill: true });
    this.releaseMaterials = services.resources.retain([this.mat, this.solid, this.sight]);
    this.model = this.buildModel();
    this.root = this.model.root;
    this.ropeView = new RemoteGrapple(services.scene, services.resources);
  }
  get parts() {
    return this.model.parts;
  }
  get J() {
    return this.model.J;
  }
  get face() {
    return this.model.face;
  }
  get tagG() {
    return this.model.tagG;
  }
  get rope() {
    return this.ropeView.rope;
  }
  get hook() {
    return this.ropeView.hook;
  }
  private get animationRig() {
    return this.model.animation;
  }
  private buildModel(): RemoteModel {
    const weapon = this.buildWeapon();
    const model = buildHumanoid(this.mat, this.solid, this.T, (gun) => {
      gun.add(weapon);
    });
    model.root.visible = false;
    this.services.scene.add(model.root);
    const tagG = new THREE.Group();
    model.root.add(tagG);
    tagG.position.y = 2.25;
    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.28, 0.02),
      makeInkMaterial({ ink: this.ink, fill: true, side: THREE.DoubleSide }),
    );
    tagG.add(flag);
    const animation = { root: model.root, joints: model.J, tag: tagG, face: model.face };
    this.corpse = false;
    this.services.resources.track(model.root);
    return { ...model, tagG, animation, weapon };
  }
  private buildWeapon() {
    return buildHeldWeapon(WEAPON_KINDS[this.weaponIndex], {
      mat: this.mat,
      dark: this.solid,
      red: this.sight,
    }).model;
  }

  // knocked flat with some physics: the whole figure tumbles away as debris (bits come off on a
  // big hit), and a fresh figure is drawn when the player comes back
  ragdoll(dir: THREE.Vector3 | null = null, over = false) {
    if (this.corpse) return;
    this.corpse = true;
    this.tagG.visible = false;
    this.ropeView.hide();
    this.death.perform(this.animationRig, this.deathPose, dir, over);
    this.root = null;
  }

  get isBlocking() {
    return this.blocking;
  }
  get blockRadius() {
    return 0;
  }
  setWeapon(i: number) {
    if (!WEAPON_KINDS[i]) i = 0;
    if (i === this.weaponIndex) return;
    this.weaponIndex = i;
    if (!this.root) return;
    this.services.resources.release(this.model.weapon);
    this.model.weapon = this.buildWeapon();
    this.services.resources.track(this.model.weapon);
    this.J.gun.add(this.model.weapon);
  }
  get snapA() {
    return this.interpolation.previous;
  }
  get snapB() {
    return this.interpolation.next;
  }
  push(snap: readonly number[] | null, t: number) {
    if (!snap) return;
    const latest = this.interpolation.push(snap, t);
    this.setWeapon(snap[5]);
    const f = snap[6];
    this.crouching = !!(f & 1);
    this.sliding = !!(f & 2);
    this.blocking = !!(f & 4);
    this.aiming = !!(f & 8);
    this.body.onGround = !!(f & 16);
    this.firing = !!(f & 32);
    const wasAlive = this.alive;
    this.alive = !!(f & 64);
    this.hp = snap[7];
    if (snap.length > 10) this.vel.set(snap[8], snap[9], snap[10]);
    else this.vel.set(0, 0, 0);
    this.grappling = !!(f & 128) && snap.length > 13;
    if (this.grappling) this.gPoint.set(snap[11], snap[12], snap[13]);
    this.parryWindow = !!(f & 256);
    const idle = !!(f & 512);
    if (idle && !this.idle) this.idleSince = t;
    this.idle = idle;
    this.untouched = !!(f & 1024);
    this.away = !!(f & 2048);
    if (wasAlive && !this.alive) this.deadT = 0;
    if (this.alive && this.corpse) {
      this.model = this.buildModel();
      this.root = this.model.root;
      this.animation.resetAim(this.aiming);
      this.interpolation.clearPrevious();
      this.body.pos.copy(latest.p);
    }
    const root = this.root;
    if (!root) return;
    if (this.away) root.visible = false;
    else if (!root.visible) {
      this.body.pos.copy(latest.p);
      root.visible = true;
    }
  }
  // damage dealt to this player by the host's bots or by another player's shot goes to its owner
  takeDamage(amount: number, fromPos: THREE.Vector3 | null = null) {
    if (this.onDamage) this.onDamage(this, amount, fromPos);
  }
  knockback() {
    /* the owner's client applies its own physics */
  }
  tryBlockMelee(e: { center: THREE.Vector3 }) {
    if (!this.alive || !this.blocking) return false;
    _v.subVectors(e.center, this.eye).normalize();
    return _v.dot(this.forward) > 0.35;
  }
  tryDeflect(): false {
    return false;
  }
  flash() {
    this.flashT = 0.08;
    setFill(this.mat, true);
  }
  update(dt: number, now: number) {
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) setFill(this.mat, false);
    }
    const angles = this.interpolation.update(dt, now);
    if (angles) {
      this.yaw = angles.yaw;
      this.pitch = angles.pitch;
    }
    this.speed = this.body.vel.length();
    this.body.height = this.crouching ? 1.05 : 1.75;
    this.eye.set(this.body.pos.x, this.body.pos.y + (this.crouching ? 0.88 : 1.6), this.body.pos.z);
    this.center.set(this.body.pos.x, this.body.pos.y + this.body.height * 0.55, this.body.pos.z);
    this.forward.set(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    if (!this.alive) this.deadT += dt;
    if (!this.root) {
      for (const hs of this.hitSpheres) hs.set(0, -100, 0);
      this.rope.visible = false;
      this.hook.visible = false;
      return;
    }
    this.root.position.copy(this.body.pos);
    this.root.rotation.y = this.yaw + Math.PI;
    this._animate(dt);
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < HIT.length; i++)
      this.hitSpheres[i].setFromMatrixPosition(this.parts[HIT[i][0]].matrixWorld);
    this._updateRope();
  }
  private _updateRope() {
    this.ropeView.update(
      this.grappling && this.alive && !this.away,
      this.body.pos,
      this.right,
      this.gPoint,
    );
  }

  private _animate(dt: number) {
    const frame = this.animationFrame;
    frame.onGround = this.body.onGround;
    frame.alive = this.alive;
    frame.blade = WEAPON_KINDS[this.weaponIndex] === 'blade';
    frame.aiming = this.aiming;
    frame.blocking = this.blocking;
    frame.pitch = this.pitch;
    frame.sliding = this.sliding;
    frame.crouching = this.crouching;
    frame.localEye = this.alive ? this.services.localEye() : null;
    this.animation.update(frame, this.animationRig, dt);
  }

  dispose() {
    if (this.root) this.services.resources.release(this.root);
    this.ropeView.dispose();
    this.releaseMaterials();
  }
}
