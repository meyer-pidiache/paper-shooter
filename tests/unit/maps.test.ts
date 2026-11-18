import { afterEach, describe, expect, it, vi } from 'vitest';
import baseline from '../fixtures/maps-baseline.json';
import { Scene } from 'three';
import { World } from '../../src/engine/physics.js';
import { buildLevel, LEVELS } from '../../src/maps/index.js';
import { levelFingerprint, seededRandom } from '../support/level-fingerprint';

afterEach(() => vi.restoreAllMocks());

describe('existing map output at c74df47', () => {
  for (const key of ['district', 'mexico'] as const) {
    for (const arena of [false, true]) {
      it(`preserves ${key} in ${arena ? 'arena' : 'solo'}`, () => {
        vi.spyOn(Math, 'random').mockImplementation(seededRandom());
        expect(levelFingerprint(key, arena)).toEqual(baseline[`${key}-${arena}`]);
      });
    }
  }

  it('offers both existing maps', () => {
    expect(LEVELS.map((level) => level.key)).toEqual(['district', 'mexico']);
  });
});

it('joins both District arena roofs with a single deck and clear railing openings', () => {
  const world = new World();
  buildLevel(new Scene(), world, 'district', { arena: true });
  const deckAt = (x: number) =>
    world.boxes.filter(
      ({ min, max }) =>
        min.x < x && max.x > x && min.z < 6 && max.z > 6 && max.y === 12 && min.y === 11.6,
    );
  const [deck] = deckAt(0);
  expect(deck).toBeDefined();
  expect(deck.min.x).toBe(-25);
  expect(deck.max.x).toBe(24);
  expect(deckAt(-24.9)).toEqual([deck]);
  expect(deckAt(23.9)).toEqual([deck]);
  expect(deckAt(-25.1)).toHaveLength(1);
  expect(deckAt(24.1)).toHaveLength(1);
  const rails = world.boxes.filter(
    ({ min, max, data }) =>
      min.y === 12 &&
      data.noShoot &&
      data.noNav &&
      min.x < 20 &&
      max.x > -20 &&
      min.z > 4.6 &&
      max.z < 7.4,
  );
  expect(rails.map(({ min, max }) => [min.x, max.x, (min.z + max.z) / 2])).toEqual([
    [-25, 24, 7.2],
    [-25, 24, 4.8],
  ]);
  for (const x of [-25, 24])
    expect(
      world.boxes.some(
        ({ min, max }) =>
          min.x < x && max.x > x && min.z < 6 && max.z > 6 && min.y === 12 && max.y > 12,
      ),
    ).toBe(false);
});
