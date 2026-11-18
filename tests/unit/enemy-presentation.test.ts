import { expect, it, vi } from 'vitest';
import { BoxGeometry, CylinderGeometry, Group, Mesh, Scene, Vector3 } from 'three';
import { TYPES } from '../../src/domain/enemies.js';
import { buildEnemyModel } from '../../src/presentation/models/enemy.js';
import { SceneResources } from '../../src/engine/resources.js';
import { EnemyLaser } from '../../src/presentation/characters/laser.js';
import { DeathPose } from '../../src/presentation/characters/death-pose.js';
import { WalkerAnimation } from '../../src/presentation/characters/walker-animation.js';
import {
  animationFrame,
  type WalkingJoints,
} from '../../src/presentation/characters/animation-contracts.js';
it('lazily reuses the laser, hides an unsafe close beam and releases its resources once', () => {
  const scene = new Scene(),
    resources = new SceneResources(),
    laser = new EnemyLaser(scene, resources);
  laser.hide();
  laser.setVisible(true);
  laser.dispose();
  expect(scene.children).toHaveLength(0);
  laser.show(new Vector3(), new Vector3(0, 0, -8), 0.5);
  const beam = scene.children[0] as Mesh,
    geometryDisposed = vi.fn(),
    materialDisposed = vi.fn();
  beam.geometry.addEventListener('dispose', geometryDisposed);
  if (Array.isArray(beam.material)) throw Error('Expected one ink material');
  beam.material.addEventListener('dispose', materialDisposed);
  const count = resources.resourceCount;
  expect(count).toBeGreaterThan(0);
  laser.show(new Vector3(), new Vector3(0, 0, -9), 1);
  expect(scene.children).toEqual([beam]);
  expect(resources.resourceCount).toBe(count);
  laser.hide();
  expect(beam.visible).toBe(false);
  laser.setVisible(true);
  expect(beam.visible).toBe(true);
  laser.show(new Vector3(), new Vector3(), 1);
  expect(beam.visible).toBe(false);
  expect(beam.matrix.elements.every(Number.isFinite)).toBe(true);
  laser.dispose();
  laser.dispose();
  expect(scene.children).toHaveLength(0);
  expect(resources.resourceCount).toBe(0);
  expect(geometryDisposed).toHaveBeenCalledOnce();
  expect(materialDisposed).toHaveBeenCalledOnce();
});
it('owns bounded death interpolation and fades only at corpse retirement', () => {
  const root = new Group(),
    pivot = new Group();
  root.scale.setScalar(2);
  const pose = new DeathPose(root, pivot, { axis: 'z', sign: -1 });
  pose.update(1, 1, 2, 0.7);
  expect(pivot.rotation.z).toBe(-Math.PI / 2);
  expect(pivot.rotation.x).toBe(0);
  expect(root.scale.x).toBe(2);
  expect(root.rotation.y).toBe(0.7);
  pose.update(100, 8.6, 2, 0.7);
  expect(pivot.rotation.z).toBe(-Math.PI / 2);
  expect(root.scale.x).toBeGreaterThan(0);
  expect(root.scale.x).toBeLessThan(2);
  pose.update(1, 10, 2, 0.7);
  expect(root.scale.toArray()).toEqual([0.001, 0.001, 0.001]);
});
function joints(): WalkingJoints {
  const model = {
    hips: new Group(),
    torso: new Group(),
    headG: new Group(),
    armL: new Group(),
    armR: new Group(),
    foreL: new Group(),
    foreR: new Group(),
    legL: new Group(),
    legR: new Group(),
    shinL: new Group(),
    shinR: new Group(),
    gun: new Group(),
  };
  model.foreL.position.y = -0.3;
  model.foreR.position.y = -0.3;
  return model;
}
it('keeps gait phase local to each model without mutating its borrowed animation input', () => {
  const first = joints(),
    second = joints(),
    reference = joints();
  const a = new WalkerAnimation({ weapon: 'rifle' }, first, 0),
    b = new WalkerAnimation({ weapon: 'rifle' }, second, 0),
    control = new WalkerAnimation({ weapon: 'rifle' }, reference, 0);
  const frame = animationFrame(new Vector3(4, 0, 0), new Vector3());
  frame.onGround = true;
  frame.aimAmt = 0.6;
  const before = structuredClone(frame);
  for (let i = 0; i < 20; i++) a.update(frame, 0.05, new Vector3(0, 1, -5));
  b.update(frame, 0.05, new Vector3(0, 1, -5));
  control.update(frame, 0.05, new Vector3(0, 1, -5));
  expect(second.legL.rotation.x).toBe(reference.legL.rotation.x);
  expect(second.legL.rotation.x).not.toBe(first.legL.rotation.x);
  expect(structuredClone(frame)).toEqual(before);
});

it.each([
  ['grunt', 0.42],
  ['heavy', 0.92],
  ['sniper', 1.25],
  ['shield', 0.3],
] as const)('raises the %s weapon towards its target as the bot aims', (type, barrelLength) => {
  const definition = TYPES[type];
  const model = buildEnemyModel(definition);
  if (model.kind !== 'walking') throw new Error('Expected a walking enemy');
  const resources = new SceneResources();
  resources.track(model.root);
  try {
    const gun = model.J.gun;
    const weapon = gun.children.find((child) => child instanceof Group)!;
    const barrel = weapon.children.find(
      (part): part is Mesh<CylinderGeometry> =>
        part instanceof Mesh && part.geometry instanceof CylinderGeometry,
    )!;
    expect(barrel.geometry.parameters.height).toBe(barrelLength);

    const animation = new WalkerAnimation(definition, model.J, 0);
    const frame = animationFrame(new Vector3(), model.center);
    const target = new Vector3(1, 2, 8);
    const axis = new Vector3();
    animation.update(frame, 1 / 60, target);
    const carryHeight = gun.getWorldPosition(new Vector3()).y;
    expect(gun.getWorldDirection(axis).dot(target.clone().normalize())).toBeLessThan(0.9);

    frame.aimAmt = 1;
    animation.update(frame, 1 / 60, target);
    expect(gun.getWorldPosition(new Vector3()).y).toBeGreaterThan(carryHeight + 0.2);
    expect(gun.getWorldDirection(axis).dot(target.clone().normalize())).toBeGreaterThan(0.999);
    const muzzle = barrel.worldToLocal(model.tip.getWorldPosition(new Vector3()));
    expect(muzzle.x).toBeCloseTo(0);
    expect(muzzle.y).toBeCloseTo(0);
    expect(muzzle.z).toBeLessThan(0);
    if (type === 'shield') expect(model.J.foreL.rotation.x).toBe(-0.9);
  } finally {
    resources.dispose();
  }
});

it('equips the rusher with a katana and retains its attack windup', () => {
  const model = buildEnemyModel(TYPES.rusher);
  if (model.kind !== 'walking') throw new Error('Expected a walking enemy');
  const resources = new SceneResources();
  resources.track(model.root);
  try {
    const weapon = model.J.gun.children.find((child) => child instanceof Group)!;
    expect(
      weapon.children.some(
        (part) =>
          part instanceof Mesh &&
          part.geometry instanceof BoxGeometry &&
          part.geometry.parameters.depth === 1,
      ),
    ).toBe(true);
    const animation = new WalkerAnimation(TYPES.rusher, model.J, 0);
    const frame = animationFrame(new Vector3(), model.center);
    const target = new Vector3(0, 0, 3);
    animation.update(frame, 1 / 60, target);
    const carry = model.J.armR.rotation.x;
    frame.attackT = 0.3;
    animation.update(frame, 1 / 60, target);
    expect(model.J.armR.rotation.x).toBeLessThan(carry - 1);
  } finally {
    resources.dispose();
  }
});
