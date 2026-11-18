import { expect, it } from 'vitest';
import { Scene, Vector3, Group, MeshBasicMaterial } from 'three';
import { SceneResources } from '../../src/engine/resources.js';
import { RemoteGrapple } from '../../src/presentation/remote-grapple.js';
import {
  RemoteAnimation,
  remoteAnimationFrame,
} from '../../src/presentation/characters/remote-animation.js';
import { buildHumanoid } from '../../src/presentation/models/humanoid.js';
import { RemotePlayer } from '../../src/gameplay/remote-player.js';
import { INK } from '../../src/shared/ink.js';
it('projects and retires remote ropes independently without changing borrowed endpoints', () => {
  const scene = new Scene(),
    resources = new SceneResources();
  const first = new RemoteGrapple(scene, resources),
    second = new RemoteGrapple(scene, resources);
  const position = new Vector3(1, 0, 2),
    right = new Vector3(1, 0, 0),
    point = new Vector3(5, 6, 7);
  first.update(true, position, right, point);
  expect(first.rope.visible).toBe(true);
  expect(first.hook.position).toEqual(point);
  expect(first.rope.scale.y).toBeCloseTo(point.distanceTo(new Vector3(1.35, 1.25, 2)));
  expect(point).toEqual(new Vector3(5, 6, 7));
  second.update(true, new Vector3(), right, new Vector3(0, 4, 0));
  const secondPosition = second.rope.position.clone();
  first.hide();
  expect(first.hook.visible).toBe(false);
  first.dispose();
  expect(second.rope.position).toEqual(secondPosition);
  expect(second.rope.parent).toBe(scene);
  second.dispose();
  expect(resources.resourceCount).toBe(0);
});
it('owns remote guard, airborne and slumped poses while leaving the borrowed frame unchanged', () => {
  const resources = new SceneResources();
  const model = buildHumanoid(new MeshBasicMaterial(), new MeshBasicMaterial(), {
    weapon: 'rifle',
    scale: 1,
  });
  resources.track(model.root);
  try {
    const rig = { root: model.root, joints: model.J, face: model.face, tag: new Group() };
    const frame = remoteAnimationFrame(new Vector3(0, 1, 8), new Vector3());
    frame.onGround = false;
    frame.blade = true;
    frame.blocking = true;
    frame.localEye = new Vector3(3, 2, 5);
    const before = JSON.stringify(frame);
    const animation = new RemoteAnimation();
    animation.update(frame, rig, 0.1);
    expect(JSON.stringify(frame)).toBe(before);
    expect(model.J.legL.rotation.x).toBe(-0.5);
    expect(model.J.armR.rotation.z).toBe(-0.8);
    expect(model.face.eyes.visible).toBe(true);
    frame.alive = false;
    const tag = rig.tag.rotation.y;
    animation.update(frame, rig, 0.1);
    expect(model.face.xeyes.visible).toBe(true);
    expect(model.root.rotation.x).toBeGreaterThan(0);
    expect(rig.tag.rotation.y).toBe(tag);
  } finally {
    resources.dispose();
  }
});

it('uses the latest snapshot to mount the weapon and raise or lower it while aiming', () => {
  const scene = new Scene();
  const resources = new SceneResources();
  const remote = new RemotePlayer(
    {
      scene,
      resources,
      effects: { debris() {}, blood() {}, bloodPool() {} },
      localEye: () => null,
    },
    'peer',
    'paper',
    0,
    INK.BLUE,
  );
  const snapshot = (weapon: number, flags: number, time: number, pitch = 0.2) => {
    remote.push([0, 0, 0, 0.3, pitch, weapon, flags, 100, 0, 0, 0], time);
    remote.update(0.25, time + 0.1);
    return remote.J.gun.children.find((child) => child instanceof Group)!;
  };
  const alive = 64 | 16;
  const aim = 8;
  const gunHeight = () => remote.J.gun.getWorldPosition(new Vector3()).y;
  try {
    const rifle = snapshot(0, alive, 1);
    const carryHeight = gunHeight();
    expect(snapshot(0, alive | aim, 2)).toBe(rifle);
    expect(gunHeight()).toBeGreaterThan(carryHeight + 0.2);
    expect(remote.J.gun.getWorldDirection(new Vector3()).dot(remote.forward)).toBeGreaterThan(
      0.999,
    );

    const shotgun = snapshot(1, alive | aim | 1, 3, 1.4);
    expect(rifle.parent).toBeNull();
    expect(shotgun).not.toBe(rifle);
    expect(remote.J.gun.getWorldDirection(new Vector3()).dot(remote.forward)).toBeGreaterThan(
      0.999,
    );

    const sniper = snapshot(2, alive, 4);
    expect(shotgun.parent).toBeNull();
    expect(sniper).not.toBe(shotgun);
    expect(gunHeight()).toBeCloseTo(carryHeight, 1);
    expect(remote.J.gun.getWorldDirection(new Vector3()).dot(remote.forward)).toBeLessThan(0.9);

    const blade = snapshot(3, alive | 4, 5);
    expect(sniper.parent).toBeNull();
    expect(blade).not.toBe(sniper);
    expect(remote.J.armR.rotation.z).toBe(-0.8);

    snapshot(3, 0, 6);
    remote.ragdoll();
    const corpseGun = remote.J.gun;
    expect(snapshot(2, alive | aim, 7)).not.toBe(blade);
    expect(blade.parent).toBe(corpseGun);
    expect(remote.weaponIndex).toBe(2);
    expect(gunHeight()).toBeGreaterThan(carryHeight + 0.2);
  } finally {
    remote.dispose();
    resources.release(scene);
  }
  expect(resources.resourceCount).toBe(0);
});
