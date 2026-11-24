import { Scene, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { makeBody, World } from '../../src/engine/physics.js';
import { outsideArena, wrapArenaPlayer } from '../../src/gameplay/player/arena-wrap.js';
import { RemoteInterpolation } from '../../src/gameplay/remote/interpolation.js';
import { buildLevel } from '../../src/maps/index.js';

it.each(['district', 'mexico'] as const)(
  'finds a grounded landing after crossing each %s edge and corner',
  (map) => {
    const world = new World();
    const { bounds, arenaSpawns } = buildLevel(new Scene(), world, map, { arena: true });
    const x = bounds.maxX + 9;
    const z = bounds.maxZ + 9;
    for (const [fromX, fromZ] of [
      [x, 17],
      [-x, 17],
      [17, z],
      [17, -z],
      [x, z],
      [-x, -z],
    ]) {
      const body = makeBody(new Vector3(fromX, -2, fromZ), 0.35, 1.75, 0.55);
      expect(wrapArenaPlayer(body, world, bounds, arenaSpawns, [])).toBe(true);
      expect(outsideArena(body.pos, bounds)).toBe(false);
      expect(world.overlapsBody(body)).toBe(false);
      if (Math.abs(fromX) === x) expect(body.pos.x * fromX).toBeLessThan(0);
      if (Math.abs(fromZ) === z) expect(body.pos.z * fromZ).toBeLessThan(0);
    }
  },
);

it('checks the whole landing volume, avoids nearby players, and falls back to a supported spawn', () => {
  const world = new World();
  const bounds = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
  const from = new Vector3(29, 0, 0);
  world.addBox(new Vector3(-20, -1, -20), new Vector3(-5, 0, 20));
  world.addBox(new Vector3(-14.8, 0, -0.5), new Vector3(-14.6, 3, 0.5));
  world.addBox(new Vector3(8, -1, 8), new Vector3(12, 0, 12));
  world.finalize();
  const body = makeBody(from, 0.35, 1.75, 0.55);
  const opponent = { alive: true, body: makeBody(new Vector3(-14, 0, 0), 0.35, 1.75, 0.55) };
  const spawn = new Vector3(10, 0, 10);
  expect(wrapArenaPlayer(body, world, bounds, [spawn], [opponent])).toBe(true);
  expect(body.pos).toMatchObject({ x: -15, z: 1 });
  expect(world.overlapsBody(body)).toBe(false);

  body.pos.copy(from);
  world.clear();
  world.addBox(new Vector3(8, -1, 8), new Vector3(12, 0, 12));
  world.finalize();
  expect(wrapArenaPlayer(body, world, bounds, [spawn], [opponent])).toBe(true);
  expect(body.pos).toMatchObject({ x: 10, z: 10 });
});

it('snaps replicas across the arena and resumes ordinary interpolation with the next packet', () => {
  const body = makeBody(new Vector3(75, 0, 10), 0.35, 1.75, 0.55);
  const replica = new RemoteInterpolation(body, new Vector3(20, 0, 0));
  replica.push([75, 0, 10, 0, 0], 1);
  replica.push([-63, 0, 10, 0, 0], 1.05);
  replica.update(1 / 60, 1.06);
  expect(body.pos.x).toBe(-63);
  replica.push([-62, 0, 10, 0, 0], 1.1);
  replica.update(1 / 60, 1.16);
  expect(body.pos.x).toBeGreaterThan(-63);
  expect(body.pos.x).toBeLessThan(-62);
});
