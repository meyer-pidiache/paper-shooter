// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { RemotePlayer, encodeLocal } from '../../src/gameplay/remote-player.js';
import { applicationFixture } from '../support/application.js';
import { INK } from '../../src/shared/ink.js';
import baseline from '../fixtures/remote-player-baseline.json';
let fixture, remote;
afterEach(() => {
  remote?.dispose();
  remote = null;
  fixture?.app.dispose();
  fixture = null;
  vi.clearAllTimers();
  vi.useRealTimers();
});
const number = (value) => +value.toFixed(10);
const vector = (value) => value.toArray().map(number);
function nodes(root, withGeometry = false) {
  if (!root) return null;
  root.updateWorldMatrix(true, true);
  const values = [];
  root.traverse((node) => {
    const geometry = createHash('sha256');
    if (withGeometry && node.geometry) {
      for (const [key, attribute] of Object.entries(node.geometry.attributes)) {
        geometry.update(key);
        geometry.update(
          Buffer.from(
            attribute.array.buffer,
            attribute.array.byteOffset,
            attribute.array.byteLength,
          ),
        );
      }
      const index = node.geometry.index;
      if (index)
        geometry.update(
          Buffer.from(index.array.buffer, index.array.byteOffset, index.array.byteLength),
        );
    }
    values.push({
      matrix: node.matrixWorld.elements.map(number),
      visible: node.visible,
      ink: node.material?.uniforms?.uInk.value,
      fill: node.material?.uniforms?.uFill.value,
      geometry: withGeometry && node.geometry ? geometry.digest('hex') : undefined,
    });
  });
  return values;
}
function capture() {
  const { effects, resources } = fixture;
  return {
    position: vector(remote.body.pos),
    velocity: vector(remote.body.vel),
    center: vector(remote.center),
    eye: vector(remote.eye),
    forward: vector(remote.forward),
    yaw: number(remote.yaw),
    pitch: number(remote.pitch),
    speed: number(remote.speed),
    hp: remote.hp,
    alive: remote.alive,
    weapon: remote.weaponIndex,
    crouching: remote.crouching,
    sliding: remote.sliding,
    blocking: remote.blocking,
    aiming: remote.aiming,
    firing: remote.firing,
    idle: remote.idle,
    idleSince: remote.idleSince,
    untouched: remote.untouched,
    away: remote.away,
    parry: remote.parryWindow,
    grappling: remote.grappling,
    grapplePoint: vector(remote.gPoint),
    hitSpheres: remote.hitSpheres.map(vector),
    model: nodes(remote.root, true),
    rope: nodes(remote.rope),
    hook: nodes(remote.hook),
    fragments: effects.debrisList.map((item) => ({
      nodes: nodes(item.mesh),
      velocity: vector(item.vel),
      angular: vector(item.ang),
      life: number(item.life),
      rest: item.rest,
    })),
    particles: effects.particles.length,
    resources: resources.resourceCount,
    randomCalls: vi.mocked(Math.random).mock.calls.length,
  };
}
it('preserves remote snapshots, poses, weapon replacement, ragdolls and respawn retirement', () => {
  vi.useFakeTimers();
  fixture = applicationFixture();
  fixture.app.session.begin();
  const { remoteServices, world, player, effects, resources } = fixture;
  world.clear();
  world.addBox({ x: -100, y: -1, z: -100 }, { x: 100, y: 0, z: 100 });
  world.finalize();
  remote = new RemotePlayer(remoteServices, 'remote', 'paper', 0, INK.RED);
  const frames = [],
    wire = [];
  const deliver = (frame) => {
    const dead = (frame >= 120 && frame < 180) || (frame >= 240 && frame < 270);
    const flags =
      (frame % 50 < 15 ? 1 : 0) |
      (frame % 70 < 10 ? 2 : 0) |
      (frame % 40 < 12 ? 4 | 256 : 0) |
      (frame % 30 < 10 ? 8 : 0) |
      (frame % 45 < 32 ? 16 : 0) |
      (frame % 20 < 8 ? 32 : 0) |
      (dead ? 0 : 64) |
      (frame % 60 < 24 ? 128 : 0) |
      (frame >= 80 && frame < 110 ? 512 : 0) |
      (frame === 70 ? 1024 : 0) |
      (frame >= 200 && frame < 210 ? 2048 : 0);
    const packet = [
      Math.sin(frame * 0.04) * 4,
      frame % 45 >= 32 ? 2 : 0,
      -8 - frame * 0.01,
      frame * 0.03,
      Math.sin(frame * 0.07),
      Math.floor(frame / 15) % 4,
      flags,
      dead ? 0 : 100 - (frame % 40),
      2,
      frame % 45 >= 32 ? 3 : 0,
      -1,
    ];
    if (flags & 128) packet.push(5, 8, -12);
    remote.push(packet, frame * 0.03);
  };
  for (let frame = 0; frame < 330; frame++) {
    if (frame % 5 === 0) deliver(frame);
    if (frame === 120 || frame === 240) {
      remote.ragdoll(new Vector3(0.4, 0.2, -1), frame === 120);
      frames.push(capture());
    }
    if (frame === 60 || frame === 190) remote.flash();
    player.eye.x = Math.sin(frame * 0.02) * 6;
    remote.update(0.03, frame * 0.03);
    effects.update(0.03);
    if (frame % 10 === 0 || [121, 179, 180, 181, 239, 241, 269, 270, 271, 329].includes(frame))
      frames.push(capture());
    if (frame % 50 === 0)
      wire.push(
        encodeLocal(player, player.weaponIndex, {
          firing: true,
          idle: frame > 100,
          untouched: frame > 200,
          away: frame > 300,
        }),
      );
  }
  remote.dispose();
  remote = null;
  for (let frame = 0; frame < 240; frame++) effects.update(0.05);
  const result = {
    source: 'issue-17',
    frames: frames.length,
    digest: createHash('sha256').update(JSON.stringify({ frames, wire })).digest('hex'),
    remainingFragments: effects.debrisList.length,
    resources: resources.resourceCount,
    randomCalls: vi.mocked(Math.random).mock.calls.length,
  };
  if (process.env.RECORD_REMOTE_BASELINE === '1')
    writeFileSync(
      'tests/fixtures/remote-player-baseline.json',
      JSON.stringify(result, null, 2) + '\n',
    );
  else {
    if (result.digest !== baseline.digest) {
      mkdirSync('reports', { recursive: true });
      writeFileSync('reports/remote-player-trace.json', JSON.stringify({ result, frames, wire }));
    }
    expect(result).toEqual(baseline);
  }
  expect(effects.debrisList).toHaveLength(0);
});
