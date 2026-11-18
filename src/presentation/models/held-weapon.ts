import { Group } from 'three';
import {
  buildRifleBody,
  buildShotgunBody,
  buildSniperBody,
  buildRevolverBody,
  GUN_ATTACHMENTS,
} from './guns.js';
import { buildKatanaBody, KATANA_TIP } from './katana.js';
import type { CharacterAppearance } from './character-contracts.js';
import type { GunMaterials, Triple } from './weapon-contracts.js';

const guns = {
  rifle: { build: buildRifleBody, ...GUN_ATTACHMENTS.rifle },
  shotgun: { build: buildShotgunBody, ...GUN_ATTACHMENTS.shotgun },
  sniper: { build: buildSniperBody, ...GUN_ATTACHMENTS.sniper },
  pistol: { build: buildRevolverBody, ...GUN_ATTACHMENTS.revolver },
};
type HeldWeaponKind = keyof typeof guns | 'blade';

export function isHeldWeapon(kind: CharacterAppearance['weapon']): kind is HeldWeaponKind {
  return kind === 'blade' || Object.hasOwn(guns, kind);
}

export function buildHeldWeapon(kind: HeldWeaponKind, materials: GunMaterials) {
  const model = new Group();
  let grip: Triple;
  let tip: Triple;
  if (kind === 'blade') {
    buildKatanaBody(model, materials.mat, materials.dark);
    grip = [0, 0, 0.05];
    tip = KATANA_TIP;
  } else {
    const gun = guns[kind];
    gun.build(model, materials);
    grip = gun.grip;
    tip = gun.muzzle;
  }
  const scale = 0.75;
  // View models point down -Z. The avatar faces +Z with the weapon mounted at its right hand.
  model.rotation.y = Math.PI;
  model.scale.setScalar(scale);
  model.position.set(grip[0] * scale, -grip[1] * scale, grip[2] * scale);
  const tipPosition: Triple = [
    (grip[0] - tip[0]) * scale,
    (tip[1] - grip[1]) * scale,
    (grip[2] - tip[2]) * scale,
  ];
  return { model, tipPosition };
}
