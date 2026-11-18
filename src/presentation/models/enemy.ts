import { DoubleSide, Vector3, type Group, type Object3D } from 'three';
import type { EnemyDefinition } from '../../domain/enemy-definitions.js';
import { INK } from '../../shared/ink.js';
import { makeInkMaterial, type InkMaterial } from '../ink/materials.js';
import { buildHumanoid } from './humanoid.js';
import { buildHeldWeapon, isHeldWeapon } from './held-weapon.js';
import { buildBomber } from './bomber.js';
import { buildFlyer } from './flyer.js';
import type { WalkingJoints, FlyingJoints } from '../characters/animation-contracts.js';
import type { CharacterPart, CharacterHit } from './character-contracts.js';
export interface CharacterParts extends Partial<Record<CharacterPart, Object3D>> {
  head: Object3D;
  torso: Object3D;
}
interface EnemyRig {
  root: Group;
  parts: CharacterParts;
  tip: Object3D;
  face: { eyes: Group; xeyes: Group };
  hit: CharacterHit[];
  hitSpheres: Vector3[];
  center: Vector3;
  mat: InkMaterial;
}
export interface WalkingRig extends EnemyRig {
  kind: 'walking';
  J: WalkingJoints & { shieldG: Group | null };
}
export interface FlyingRig extends EnemyRig {
  kind: 'flying';
  J: FlyingJoints & { headG: Object3D; torso: Object3D; gun: Object3D };
}
export type EnemyModel = WalkingRig | FlyingRig;
/** Geometry/material recipe with a discriminated rig and owned, mutable hit-region projection data. */
export function buildEnemyModel(definition: EnemyDefinition): EnemyModel {
  const mat = makeInkMaterial({ ink: definition.ink ?? INK.RED, shadeScale: 0, shadeBias: 1 });
  const solid = makeInkMaterial({
    ink: definition.ink === INK.BLACK ? INK.RED : INK.BLACK,
    fill: true,
    side: DoubleSide,
  });
  if (definition.model === 'bomber' || definition.model === 'blob') {
    const model = buildBomber(mat, solid, definition, definition.model === 'blob');
    return {
      ...model,
      kind: 'walking',
      J: { ...model.J, shieldG: null },
      hitSpheres: model.hit.map(() => new Vector3()),
      center: new Vector3(),
      mat,
    };
  }
  if (definition.model === 'flyer') {
    const model = buildFlyer(mat, solid, definition);
    return {
      ...model,
      kind: 'flying',
      hitSpheres: model.hit.map(() => new Vector3()),
      center: new Vector3(),
      mat,
    };
  }
  const weapon = definition.weapon;
  const model = buildHumanoid(
    mat,
    solid,
    definition,
    isHeldWeapon(weapon)
      ? (gun) => {
          const red = weapon === 'blade' ? mat : makeInkMaterial({ ink: INK.RED, fill: true });
          const held = buildHeldWeapon(weapon, { mat, dark: solid, red });
          gun.position.set(0, -0.3, 0);
          gun.add(held.model);
          return held.tipPosition;
        }
      : undefined,
  );
  return {
    ...model,
    kind: 'walking',
    hitSpheres: model.hit.map(() => new Vector3()),
    center: new Vector3(),
    mat,
  };
}
