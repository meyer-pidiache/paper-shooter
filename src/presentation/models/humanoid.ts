import * as THREE from 'three';
import type { CharacterAppearance, CharacterHit } from './character-contracts.js';
import { bx, blob, noodle, mitten, shoe } from './character-kit.js';
import { doodleFace } from './character-face.js';
import { rand } from '../../engine/math.js';
import { buildHat } from './character-hats.js';
import { buildWeaponProp } from './character-weapons.js';
import type { Triple } from './weapon-contracts.js';
export function buildHumanoid(
  mat: THREE.Material,
  solid: THREE.Material,
  T: CharacterAppearance,
  buildWeapon: (gun: THREE.Group) => Triple | void = (gun) => buildWeaponProp(gun, mat, solid, T),
) {
  const { root, hips, torso, headG, hipsPoint, torsoPoint, headPoint, fc, bodyW, limbR } =
    buildBody(mat, solid, T);
  const shY = 0.46,
    shX = 0.26 * bodyW;
  const armL = noodle([0.3, limbR], mat, torso, [-shX, shY, 0]),
    armR = noodle([0.3, limbR], mat, torso, [shX, shY, 0]);
  const foreL = noodle([0.28, limbR * 0.92], mat, armL, [0, -0.3, 0]),
    foreR = noodle([0.28, limbR * 0.92], mat, armR, [0, -0.3, 0]);
  mitten(limbR * 2.3, mat, foreL, -0.3);
  mitten(limbR * 2.3, mat, foreR, -0.3);
  const legL = noodle([0.42, limbR * 1.15], mat, hips, [-0.13 * bodyW, -0.02, 0]),
    legR = noodle([0.42, limbR * 1.15], mat, hips, [0.13 * bodyW, -0.02, 0]);
  const shinL = noodle([0.42, limbR * 1.05], mat, legL, [0, -0.42, 0]),
    shinR = noodle([0.42, limbR * 1.05], mat, legR, [0, -0.42, 0]);
  shoe(mat, shinL, -0.42, bodyW);
  shoe(mat, shinR, -0.42, bodyW);
  const gun = new THREE.Group();
  gun.position.set(0, -0.29, 0.07);
  foreR.add(gun);
  const tipPosition = buildWeapon(gun);
  const tip = new THREE.Object3D();
  tip.position.set(
    ...(tipPosition ?? [0, 0.05, T.weapon === 'blade' ? 0.92 : T.weapon === 'boss' ? 0.4 : 0.78]),
  );
  gun.add(tip);
  const { shieldG, shieldPoint } = buildShield(torso, mat, solid, T.shield);
  const J = {
    hips,
    torso,
    headG,
    armL,
    armR,
    foreL,
    foreR,
    legL,
    legR,
    shinL,
    shinR,
    gun,
    shieldG,
  };
  const hit = hitRegions(T.shield);
  root.scale.setScalar(T.scale);
  return {
    root,
    parts: {
      hips: hipsPoint,
      torso: torsoPoint,
      head: headPoint,
      armL: armL.mid,
      armR: armR.mid,
      foreL: foreL.mid,
      foreR: foreR.mid,
      legL: legL.mid,
      legR: legR.mid,
      shinL: shinL.mid,
      shinR: shinR.mid,
      ...(shieldPoint ? { shield: shieldPoint } : {}),
    },
    J,
    tip,
    face: fc,
    hit,
  };
}

function buildBody(mat: THREE.Material, solid: THREE.Material, T: CharacterAppearance) {
  const root = new THREE.Group();
  const build = T.build || {};
  const bodyW = build.bodyW ?? 1,
    headS = build.headS ?? 1,
    limbR = build.limbR ?? 0.032;
  const jit = rand(0.95, 1.06); // every figure is drawn slightly differently
  const hips = new THREE.Group();
  hips.position.y = 0.86;
  root.add(hips);
  const hipsPoint = new THREE.Object3D();
  hips.add(hipsPoint);
  const torso = new THREE.Group();
  torso.position.y = 0.04;
  hips.add(torso);
  blob([0.3 * bodyW, 0.3, 0.19 * bodyW], [0, 0.26, 0], mat, torso);
  const torsoPoint = new THREE.Object3D();
  torsoPoint.position.y = 0.26;
  torso.add(torsoPoint);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 6), mat);
  neck.position.y = 0.56;
  torso.add(neck);
  const headG = new THREE.Group();
  headG.position.y = 0.62;
  torso.add(headG);
  blob([0.275 * headS * jit, 0.3 * headS, 0.25 * headS], [0, 0.26, 0], mat, headG);
  const headPoint = new THREE.Object3D();
  headPoint.position.y = 0.26;
  headG.add(headPoint);
  const faceG = new THREE.Group();
  faceG.position.y = 0.26;
  faceG.scale.setScalar(headS);
  headG.add(faceG);
  const fc = doodleFace(faceG, solid, { ez: 0.2 * headS + 0.06, smile: T.weapon === 'blade' });
  const hatG = new THREE.Group();
  hatG.position.y = 0.26;
  hatG.scale.setScalar(headS);
  headG.add(hatG);
  buildHat(hatG, mat, solid, T);
  return { root, hips, torso, headG, hipsPoint, torsoPoint, headPoint, fc, bodyW, limbR };
}
function buildShield(
  torso: THREE.Group,
  mat: THREE.Material,
  solid: THREE.Material,
  enabled = false,
) {
  let shieldG: THREE.Group | null = null;
  let shieldPoint: THREE.Object3D | undefined;
  if (enabled) {
    shieldG = new THREE.Group();
    shieldG.position.set(-0.17, 0.34, 0.46);
    torso.add(shieldG);
    bx([0.92, 1.3, 0.07], [0, 0, 0], mat, shieldG);
    bx([0.62, 0.06, 0.09], [0, 0.26, 0.04], solid, shieldG);
    bx([0.06, 0.62, 0.09], [0, 0.26, 0.04], solid, shieldG);
    shieldPoint = new THREE.Object3D();
    shieldG.add(shieldPoint);
  }
  return { shieldG, shieldPoint };
}
function hitRegions(shield = false) {
  const hit: CharacterHit[] = [
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
  if (shield) hit.unshift(['shield', 0.66]);
  return hit;
}
