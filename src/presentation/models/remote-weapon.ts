import { Group } from 'three';
import {
  buildRifleBody,
  buildShotgunBody,
  buildSniperBody,
  RIFLE_GRIP,
  SHOTGUN_GRIP,
  SNIPER_GRIP,
} from './guns.js';
import { buildKatanaBody } from './katana.js';
import type { GunMaterials, Triple } from './weapon-contracts.js';

const guns = {
  rifle: { build: buildRifleBody, grip: RIFLE_GRIP },
  shotgun: { build: buildShotgunBody, grip: SHOTGUN_GRIP },
  sniper: { build: buildSniperBody, grip: SNIPER_GRIP },
};

export function buildRemoteWeapon(kind: keyof typeof guns | 'blade', materials: GunMaterials) {
  const model = new Group();
  let grip: Triple;
  if (kind === 'blade') {
    buildKatanaBody(model, materials.mat, materials.dark);
    grip = [0, 0, 0.05];
  } else {
    guns[kind].build(model, materials);
    grip = guns[kind].grip;
  }
  const scale = 0.75;
  // View models point down -Z. The avatar faces +Z with the weapon mounted at its right hand.
  model.rotation.y = Math.PI;
  model.scale.setScalar(scale);
  model.position.set(grip[0] * scale, -grip[1] * scale, grip[2] * scale);
  return model;
}
