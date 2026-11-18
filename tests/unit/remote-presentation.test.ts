import { expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
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
  const snapshot = (weapon: number, flags: number, time: number, pitch = 0.2, dt = 0.25) => {
    remote.push([0, 0, 0, 0.3, pitch, weapon, flags, 100, 0, 0, 0], time);
    remote.update(dt, time + 0.1);
    return remote.J.gun.children.find((child) => child instanceof Group)!;
  };
  const barrelLength = (weapon: Group) =>
    weapon.children.find(
      (part): part is Mesh<CylinderGeometry> =>
        part instanceof Mesh && part.geometry instanceof CylinderGeometry,
    )?.geometry.parameters.height;
  const checkSupport = (weapon: Group) => {
    const receiver = weapon.children.find(
      (part) => part instanceof Mesh && part.geometry instanceof BoxGeometry,
    ) as Mesh<BoxGeometry>;
    const mitten = remote.J.foreL.children.find(
      (part) => part instanceof Mesh && part.geometry instanceof SphereGeometry,
    ) as Mesh<SphereGeometry>;
    receiver.geometry.computeBoundingBox();
    const hand = receiver.worldToLocal(mitten.getWorldPosition(new Vector3()));
    const nearest = receiver.geometry.boundingBox!.clampPoint(hand, new Vector3());
    expect(nearest.distanceTo(hand) * weapon.scale.x).toBeLessThan(
      mitten.geometry.parameters.radius * Math.min(...mitten.scale.toArray()),
    );
  };
  const alive = 64 | 16;
  const aim = 8;
  const gunHeight = () => remote.J.gun.getWorldPosition(new Vector3()).y;
  try {
    const rifle = snapshot(0, alive, 1);
    expect(barrelLength(rifle)).toBe(0.42);
    const carryHeight = gunHeight();
    expect(snapshot(0, alive | aim, 2)).toBe(rifle);
    expect(gunHeight()).toBeGreaterThan(carryHeight + 0.2);
    expect(remote.J.gun.getWorldDirection(new Vector3()).dot(remote.forward)).toBeGreaterThan(
      0.999,
    );

    const shotgun = snapshot(1, alive | aim | 1, 3, 1.4);
    expect(rifle.parent).toBeNull();
    expect(shotgun).not.toBe(rifle);
    expect(barrelLength(shotgun)).toBe(0.92);
    expect(remote.J.gun.getWorldDirection(new Vector3()).dot(remote.forward)).toBeGreaterThan(
      0.999,
    );

    const sniper = snapshot(2, alive, 4);
    expect(shotgun.parent).toBeNull();
    expect(sniper).not.toBe(shotgun);
    expect(barrelLength(sniper)).toBe(1.25);
    expect(gunHeight()).toBeCloseTo(carryHeight, 1);
    expect(remote.J.gun.getWorldDirection(new Vector3()).dot(remote.forward)).toBeLessThan(0.9);
    checkSupport(sniper);
    expect(snapshot(2, alive | aim, 5, 0.2, 1)).toBe(sniper);
    checkSupport(sniper);
    const aimedHeight = gunHeight();

    const blade = snapshot(3, alive | 4, 6);
    expect(sniper.parent).toBeNull();
    expect(blade).not.toBe(sniper);
    expect(
      blade.children.some(
        (part) =>
          part instanceof Mesh &&
          part.geometry instanceof BoxGeometry &&
          part.geometry.parameters.depth === 1,
      ),
    ).toBe(true);
    expect(remote.J.armR.rotation.z).toBe(-0.8);

    snapshot(3, 0, 7);
    remote.ragdoll();
    const corpseGun = remote.J.gun;
    const respawned = snapshot(2, alive | aim, 8, 0.2, 1 / 60);
    expect(respawned).not.toBe(blade);
    expect(barrelLength(respawned)).toBe(1.25);
    expect(blade.parent).toBe(corpseGun);
    expect(remote.weaponIndex).toBe(2);
    expect(gunHeight()).toBeCloseTo(aimedHeight, 5);
  } finally {
    remote.dispose();
    resources.release(scene);
  }
  expect(resources.resourceCount).toBe(0);
});

it('redraws confirmed player names and releases their textures when the avatar retires', () => {
  const context = { fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: () => context };
  vi.stubGlobal('CanvasRenderingContext2D', class {});
  vi.stubGlobal('document', { createElement: () => canvas });
  const resources = new SceneResources();
  const scene = new Scene();
  try {
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
    const tagMaterial = (remote.tagG.children[0] as Mesh<PlaneGeometry, ShaderMaterial>).material;
    const texture = tagMaterial.uniforms.uNameMask.value as CanvasTexture;
    const releaseTexture = vi.fn();
    texture.addEventListener('dispose', releaseTexture);
    expect(context.fillText).toHaveBeenLastCalledWith('paper', 256, 53, 484);
    const initialVersion = texture.version;

    remote.name = 'a very long player name';
    expect(remote.name).toBe('a very long pl');
    expect(context.fillText).toHaveBeenLastCalledWith('a very long pl', 256, 53, 484);
    expect(texture.version).toBe(initialVersion + 1);
    remote.name = 'a very long pl';
    expect(texture.version).toBe(initialVersion + 1);

    remote.dispose();
    expect(releaseTexture).toHaveBeenCalledOnce();
    expect(resources.resourceCount).toBe(0);
  } finally {
    resources.dispose();
    vi.unstubAllGlobals();
  }
});
