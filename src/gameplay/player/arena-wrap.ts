import type { Vector3 } from 'three';
import type { Body } from '../../engine/physics.js';
import type { MovementWorld } from './movement-contracts.js';

interface ArenaBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const EDGE_MARGIN = 8;
// The arena bounds run through the middle of the perimeter walls.
const WALL_CLEARANCE = 5;
export const FALL_HEIGHT = -12;
const GROUND_CLEARANCE = 0.0001;
const DOWN = { x: 0, y: -1, z: 0 };
const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

function beyond(value: number, min: number, max: number) {
  if (value < min - EDGE_MARGIN) return -1;
  if (value > max + EDGE_MARGIN) return 1;
  return 0;
}

export function outsideArena(point: Vector3, bounds: ArenaBounds) {
  return (
    beyond(point.x, bounds.minX, bounds.maxX) !== 0 ||
    beyond(point.z, bounds.minZ, bounds.maxZ) !== 0
  );
}

export function wrapArenaPlayer(
  body: Body,
  world: Pick<MovementWorld, 'raycast' | 'overlapsAABB'>,
  bounds: ArenaBounds,
  spawns: readonly Vector3[],
  opponents: Iterable<{
    readonly alive: boolean;
    readonly body: Pick<Body, 'pos' | 'height' | 'halfW'>;
  }>,
): boolean {
  const { pos, halfW, height } = body;
  const crossedX = beyond(pos.x, bounds.minX, bounds.maxX);
  const crossedZ = beyond(pos.z, bounds.minZ, bounds.maxZ);
  if (!crossedX && !crossedZ) return false;

  const occupied = Array.from(opponents).filter(({ alive }) => alive);
  const minX = bounds.minX + WALL_CLEARANCE;
  const maxX = bounds.maxX - WALL_CLEARANCE;
  const minZ = bounds.minZ + WALL_CLEARANCE;
  const maxZ = bounds.maxZ - WALL_CLEARANCE;
  const x = crossedX === 0 ? pos.x : crossedX < 0 ? maxX : minX;
  const z = crossedZ === 0 ? pos.z : crossedZ < 0 ? maxZ : minZ;
  const probeY = Math.max(1, pos.y + 1);

  function landAt(x: number, z: number, y: number) {
    x = Math.max(minX, Math.min(maxX, x));
    z = Math.max(minZ, Math.min(maxZ, z));
    const ground = world.raycast({ x, y, z }, DOWN, y - FALL_HEIGHT);
    if (!ground || ground.normal.y <= 0 || ground.point.y <= FALL_HEIGHT) return false;
    const feet = ground.point.y + GROUND_CLEARANCE;
    if (
      world.overlapsAABB(
        { x: x - halfW, y: feet, z: z - halfW },
        { x: x + halfW, y: feet + height, z: z + halfW },
      )
    )
      return false;
    for (const { body: other } of occupied) {
      if (
        Math.abs(other.pos.x - x) < other.halfW + halfW &&
        Math.abs(other.pos.z - z) < other.halfW + halfW &&
        other.pos.y < feet + height &&
        other.pos.y + other.height > feet
      )
        return false;
    }
    pos.set(x, feet, z);
    return true;
  }

  if (landAt(x, z, probeY)) return true;
  for (const radius of [1, 2, 4, 8]) {
    for (const [dx, dz] of NEIGHBORS) {
      if (landAt(x + radius * dx, z + radius * dz, probeY)) return true;
    }
  }
  return spawns.some((spawn) => landAt(spawn.x, spawn.z, spawn.y + 1));
}
