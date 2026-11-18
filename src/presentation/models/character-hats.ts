import * as THREE from 'three';
import { TAU } from '../../engine/math.js';
import { bx } from './character-kit.js';
import type { CharacterAppearance } from './character-contracts.js';
export function buildHat(
  headG: THREE.Object3D,
  mat: THREE.Material,
  solid: THREE.Material,
  T: Pick<CharacterAppearance, 'hat'>,
) {
  const h = T.hat;
  if (h === 'band') {
    const b = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.028, 5, 14), solid);
    b.rotation.x = Math.PI / 2;
    b.position.y = 0.11;
    headG.add(b);
    for (const [dx, dz, a] of [
      [0.24, -0.22, 0.5],
      [0.2, -0.3, -0.3],
    ]) {
      const t = bx([0.04, 0.03, 0.4], [dx, 0.08 - dz * 0.2, -0.26], solid, headG);
      t.rotation.y = a;
    }
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.2, 4), mat);
      sp.position.set(-0.12 + i * 0.08, 0.28, 0.02);
      sp.rotation.z = (i - 1.5) * 0.35;
      headG.add(sp);
    }
  } else if (h === 'helmet') {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 6, 0, TAU, 0, Math.PI * 0.55), mat);
    c.position.y = 0.0;
    c.scale.y = 0.85;
    headG.add(c);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.315, 0.03, 4, 14), mat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.02;
    headG.add(rim);
  } else if (h === 'hood') {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.33, 10, 7, 0, TAU, 0, Math.PI * 0.62), mat);
    c.position.y = -0.02;
    c.scale.set(1.03, 1.15, 0.95);
    headG.add(c);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.5, 5), mat);
    tail.position.set(0, 0.16, -0.3);
    tail.rotation.x = 1.5;
    headG.add(tail);
  } else if (h === 'crown') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 4), mat);
      sp.position.set(Math.cos(a) * 0.22, 0.34, Math.sin(a) * 0.22);
      headG.add(sp);
    }
    const b = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 4, 14), mat);
    b.rotation.x = Math.PI / 2;
    b.position.y = 0.24;
    headG.add(b);
  }
}
