import { expect, it } from 'vitest';
import { MapVote } from '../../src/domain/map-vote.js';

it('counts one vote per eligible player and chooses a majority ahead of rank', () => {
  const vote = new MapVote(1, ['first', 'second', 'third'], 'district');
  expect(vote.winner()).toBe('district');
  expect(vote.cast('outside', 'mexico')).toBe(false);
  vote.cast('first', 'district');
  vote.cast('second', 'mexico');
  expect(vote.cast('second', 'mexico')).toBe(false);
  expect(vote.winner()).toBe('district');
  vote.cast('third', 'mexico');
  expect(vote.complete).toBe(true);
  expect(vote.winner()).toBe('mexico');
  vote.cast('third', 'district');
  expect(vote.counts.get('district')).toBe(2);
  expect(vote.winner()).toBe('district');
});

it('breaks a tie with the highest-ranked participating voter', () => {
  const vote = new MapVote(2, ['first', 'second', 'third'], 'district');
  vote.receive([
    { id: 'third', map: 'district' },
    { id: 'second', map: 'mexico' },
  ]);
  expect(vote.complete).toBe(false);
  expect(vote.selection('second')).toBe('mexico');
  expect(vote.winner()).toBe('mexico');
});
