// Compose player state owners, preserve phase order and expose the actor command surface.
import type { PlayerServices, PlayerHitReceipt } from './player/services.js';
import type { Body } from '../engine/physics.js';
import type { FirstPersonFrame } from '../presentation/first-person.js';
import type { WeaponPose } from '../domain/weapon-frame.js';
import type { GrenadePacket, GrenadePose } from './player/grenades.js';
import type { DeflectedProjectile } from './player/combat-state.js';
import type { Gun } from './weapons/guns.js';
import { PlayerCombat } from './player/combat-state.js';
import {
  makeCombatFeedback,
  makeGrenadeFeedback,
  makeGrappleFeedback,
  makeMovementFeedback,
} from './player/feedback.js';
import { Equipment } from './player/equipment.js';
import { FirstPersonView } from '../presentation/first-person.js';
import { Locomotion } from './player/locomotion.js';
import { Grapple } from './player/grapple.js';
import { GrappleVisuals } from '../presentation/grapple.js';
import { Grenades } from './player/grenades.js';
import { GrenadeVisuals } from '../presentation/grenades.js';
import * as THREE from 'three';
import { makeBody } from '../engine/physics.js';
import { Rifle, Shotgun, Sniper, Katana } from './weapons.js';
import { clamp } from '../engine/math.js';

const STAND_H = 1.75;

export class Player {
  readonly camera: THREE.PerspectiveCamera;
  readonly body: Body;
  readonly view: FirstPersonView;
  readonly eye: THREE.Vector3;
  readonly center: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly right: THREE.Vector3;
  private readonly viewFrame: FirstPersonFrame;
  readonly rig: THREE.Group;
  readonly equipment: Equipment<Gun | Katana>;
  private readonly equipmentPose: WeaponPose;
  private readonly grenadePose: GrenadePose;
  readonly grenadeSystem: Grenades;
  readonly grappleSystem: Grapple;
  readonly locomotion: Locomotion;
  readonly combat: PlayerCombat;
  readonly isLocal = true;
  team = 0;
  name = 'you';
  shieldT = 0;
  lastHitBy: string | null = null;
  lastHit: PlayerHitReceipt | null = null;
  onFall: (() => void) | null = null;
  constructor(private readonly services: PlayerServices) {
    const { environment, input, feedback } = services;
    this.camera = environment.camera;
    this.body = makeBody(environment.spawnPoint(), 0.35, STAND_H, 0.55);
    this.view = new FirstPersonView(
      this.camera,
      this.body,
      (dt) => feedback.effects.sampleShake(dt),
      (gain) => feedback.audio.footstep(gain),
    );
    this.eye = this.view.eye;
    this.center = this.view.center;
    this.forward = this.view.forward;
    this.right = this.view.right;
    this.viewFrame = {
      alive: true,
      crouching: false,
      sliding: false,
      strafe: 0,
      sprinting: false,
      aiming: false,
      adsFov: 60,
      grappling: false,
    };
    this.rig = new THREE.Group();
    this.camera.add(this.rig);
    environment.scene.add(this.camera);
    const weapons = [
      new Rifle(services.weapons.gun),
      new Shotgun(services.weapons.gun),
      new Sniper(services.weapons.gun),
      new Katana(services.weapons.blade),
    ];
    for (const weapon of weapons) this.rig.add(weapon.root);
    this.equipment = new Equipment(weapons, {
      selected: (weapon, silent) => {
        if (!silent) feedback.audio.switchWeapon();
        feedback.hud.setWeapon(weapon.name, weapon.hint);
        feedback.hud.setCrosshairMode(weapon.kind === 'katana' ? 'katana' : '');
      },
      sights: (ads, scope) => {
        feedback.hud.setAds(ads);
        feedback.hud.setScope(scope);
      },
    });
    this.equipmentPose = {
      aiming: false,
      sprinting: false,
      grounded: false,
      speed: 0,
      sliding: false,
      lookDelta: input.look,
      strafe: 0,
      bobPhase: 0,
      bobAmt: 0,
      landDip: 0,
      alive: true,
    };

    this.grenadePose = {
      eye: this.eye,
      right: this.right,
      forward: this.forward,
      velocity: this.body.vel,
    };
    const weaponFeedback = () => this.weapon;
    this.grenadeSystem = new Grenades(
      environment.world,
      new GrenadeVisuals(environment.scene, environment.world, environment.resources),
      makeGrenadeFeedback(feedback, weaponFeedback),
    );
    this.grappleSystem = new Grapple(
      this.body,
      { eye: this.eye, center: this.center, forward: this.forward, right: this.right },
      {
        world: environment.world,
        queries: services.grappleQueries,
        view: new GrappleVisuals(environment.scene),
        feedback: makeGrappleFeedback(feedback, this.view, weaponFeedback),
      },
    );
    this.locomotion = new Locomotion(
      this.body,
      { center: this.center, right: this.right },
      environment,
      this.grappleSystem,
      makeMovementFeedback(feedback, { center: this.center, right: this.right }, this.view, () => {
        this.takeDamage(20, null);
        if (this.onFall) this.onFall();
      }),
    );
    this.combat = new PlayerCombat(
      this.body,
      { eye: this.eye, center: this.center, forward: this.forward, right: this.right },
      () => this.weapon,
      makeCombatFeedback(
        feedback,
        { eye: this.eye, center: this.center, forward: this.forward, right: this.right },
        this.view,
        () => {
          const weapon = this.weapon;
          return weapon.kind === 'katana' ? weapon : null;
        },
        () => {
          this.detachGrapple(false);
          services.died();
        },
      ),
    );
  }
  dispose() {
    this.grenadeSystem.clear();
    this.grenadeSystem.onThrow = null;
    this.grenadeSystem.onExplosion = null;
    this.equipment.dispose();
  }
  reset(pos: THREE.Vector3) {
    this.grenadeSystem.cancelCharge();
    const b = this.body;
    b.pos.copy(pos);
    b.vel.set(0, 0, 0);
    b.onGround = false;
    b.height = STAND_H;
    this.combat.reset();
    this.view.reset();
    this.locomotion.reset();
    this.grappleSystem.reset();
    this.equipment.reset();
    this.rig.visible = true;
    this.grenadeSystem.reset();
  }

  get hp() {
    return this.combat.hp;
  }
  set hp(value: number) {
    this.combat.hp = value;
  }
  get maxHp() {
    return this.combat.maxHp;
  }
  set maxHp(value: number) {
    this.combat.maxHp = value;
  }
  get alive() {
    return this.combat.alive;
  }
  get regenDelay() {
    return this.combat.regenDelay;
  }
  set regenDelay(value: number) {
    this.combat.regenDelay = value;
  }
  get regenRate() {
    return this.combat.regenRate;
  }
  set regenRate(value: number) {
    this.combat.regenRate = value;
  }
  get isBlocking() {
    return this.combat.blocking;
  }
  get blockRadius() {
    return this.combat.blockRadius;
  }
  get parryWindow() {
    return this.combat.parryWindow;
  }
  takeDamage(amount: number, from: THREE.Vector3 | null = null) {
    this.combat.takeDamage(amount, from);
  }
  knockback(direction: THREE.Vector3, amount: number) {
    this.combat.knockback(direction, amount);
  }
  tryDeflect(projectile: DeflectedProjectile) {
    return this.combat.tryDeflect(projectile);
  }
  tryBlockMelee(enemy: { center: THREE.Vector3 }) {
    return this.combat.tryBlockMelee(enemy);
  }
  die() {
    this.combat.die();
  }
  get yaw() {
    return this.view.yaw;
  }
  set yaw(value: number) {
    this.view.yaw = value;
  }
  get pitch() {
    return this.view.pitch;
  }
  set pitch(value: number) {
    this.view.pitch = value;
  }
  get speed() {
    return this.view.speed;
  }
  get hurtFx() {
    return this.view.hurtFx;
  }
  get flashFx() {
    return this.view.flashFx;
  }
  recoil(p: number, y: number) {
    this.view.recoil(p, y);
  }
  kickFov(value: number) {
    this.view.kickFov(value);
  }
  idleCam(time: number) {
    this.view.idle(time);
    this.rig.visible = false;
  }
  _updateCamera(dt: number) {
    const frame = this.viewFrame;
    frame.alive = this.alive;
    frame.crouching = this.crouching;
    frame.sliding = this.sliding;
    frame.strafe = this._mv.x;
    frame.sprinting = this._sprinting;
    frame.aiming = this._aiming;
    frame.adsFov = this.weapon.adsFov;
    frame.grappling = this.grapple.state === 'on';
    this.view.update(dt, frame);
  }
  get crouching() {
    return this.locomotion.crouching;
  }
  set crouching(value: boolean) {
    this.locomotion.crouching = value;
  }
  get sliding() {
    return this.locomotion.sliding;
  }
  get airJumps() {
    return this.locomotion.jumps.airJumps;
  }
  get gravityScale() {
    return this.locomotion.gravityScale;
  }
  set gravityScale(value: number) {
    this.locomotion.gravityScale = value;
  }
  get dashLock() {
    return this.locomotion.dashLock;
  }
  set dashLock(value: boolean) {
    this.locomotion.dashLock = value;
  }
  get _aiming() {
    return this.locomotion.aiming;
  }
  get _sprinting() {
    return this.locomotion.sprinting;
  }
  get _mv() {
    return this.locomotion.frame.mv;
  }
  get grapple() {
    return this.grappleSystem.state;
  }
  get grapStam() {
    return this.grappleSystem.stamina;
  }
  detachGrapple(boost: boolean) {
    this.grappleSystem.detach(boost);
  }
  get grenades() {
    return this.grenadeSystem.stock;
  }
  set grenades(value: number) {
    this.grenadeSystem.stock = value;
  }
  get maxGrenades() {
    return this.grenadeSystem.maximum;
  }
  get nades() {
    return this.grenadeSystem.projectiles;
  }
  get onThrow() {
    return this.grenadeSystem.onThrow;
  }
  set onThrow(handler: Grenades['onThrow']) {
    this.grenadeSystem.onThrow = handler;
  }
  clearNades() {
    this.grenadeSystem.clear();
  }
  throwGrenade(remote: GrenadePacket | null = null, charge = 0) {
    this.grenadeSystem.throw(remote, charge, this.grenadePose);
  }
  updateNades(dt: number) {
    this.grenadeSystem.update(dt);
  }

  aimDir(spread = 0) {
    return this.view.aimDir(spread);
  }
  lunge(speed: number) {
    this.locomotion.lunge(speed, this.forward);
  }
  slashKatana() {
    const blade = this.weapons[this.katanaIndex];
    if (blade.kind === 'katana') blade.startSlash(this._weaponState(false, false, 0));
  }
  get weapons() {
    return this.equipment.weapons;
  }
  get weapon() {
    return this.equipment.current;
  }
  get weaponIndex() {
    return this.equipment.index;
  }
  get katanaIndex() {
    return this.equipment.meleeIndex;
  }
  get firing() {
    return this.equipment.firing;
  }
  switchTo(index: number, silent = false) {
    this.equipment.switchTo(index, silent);
  }
  addAmmoAll(fraction = 0.5) {
    this.equipment.addAmmo(fraction);
  }

  update(dt: number) {
    this.combat.age(dt);
    if (!this.alive) {
      this._updateDead(dt);
      return;
    }
    this.rig.visible = true;
    if (this._updateLook(dt)) return;
    const motion = this.locomotion.read(dt, this.services.input, this.yaw, !!this.weapon.isGun);
    this.combat.coolBlock(dt);
    this.locomotion.accelerate(dt, motion);
    this.locomotion.jump(dt, this.services.input, motion);
    this.locomotion.integrate(dt, this.services.input, motion);
    const speed = this._recoverMovement(dt, motion.sprinting);
    this.grenadeSystem.updateInput(
      dt,
      this.services.input.down('grenade'),
      this.alive,
      this.dashLock,
      this.grenadePose,
    );
    this._updateWeaponInput(dt, motion.sprinting, motion.aiming, speed);
  }

  _updateDead(dt: number) {
    this.view.sink(dt);
    this.locomotion.fall(dt);
    this.view.updateDirections();
    this.grenadeSystem.update(dt);
    this._updateCamera(dt);
    this.weapon.animate(dt, this._weaponState(false, false, 0));
    return;
  }

  _updateLook(dt: number) {
    this.view.look(this.services.input.look, this._aiming, !!this.weapon.scope);
    if (this.locomotion.freezeIfLocked()) {
      this._updateCamera(dt);
      this.weapon.animate(dt, this._weaponState(false, false, 0));
      return true;
    }
    return false;
  }
  _recoverMovement(dt: number, sprinting: boolean) {
    const b = this.body;

    this.combat.recover(dt, this._sprinting, this.grapple.state === 'idle');
    // the grapple runs on breath: hanging drains it, feet on the ground bring it back fast
    this.grappleSystem.recover(dt);
    const hs2 = Math.hypot(b.vel.x, b.vel.z);
    this.view.updateStride(dt, sprinting, this.sliding);
    this._updateCamera(dt);

    return hs2;
  }

  _updateWeaponInput(dt: number, sprinting: boolean, aiming: boolean, speed: number) {
    this.equipment.update(dt, this.services.input, this._equipmentState(sprinting, aiming, speed));
  }
  _weaponState(sprinting: boolean, aiming: boolean, speed: number) {
    return this.equipment.frame(
      this.services.input,
      this._equipmentState(sprinting, aiming, speed),
    );
  }
  _equipmentState(sprinting: boolean, aiming: boolean, speed: number): WeaponPose {
    const state = this.equipmentPose;
    state.aiming = aiming;
    state.sprinting = sprinting;
    state.grounded = this.body.onGround;
    state.speed = speed;
    state.sliding = this.sliding;
    state.lookDelta = this.services.input.look;
    state.strafe = this._mv.x;
    state.bobPhase = this.view.bobPhase;
    state.bobAmt = this.view.bobAmt;
    state.landDip = clamp(-this.view.landDipValue * 0.08, -0.5, 0.5);
    state.alive = this.alive;
    return state;
  }
}
