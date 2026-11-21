import { expect, it } from 'vitest';
import { MatchRejoins } from '../../src/application/match-rejoins.js';

it('keeps a disconnected score until the grace period expires', () => {
  let now = 0;
  const rejoins = new MatchRejoins(() => now);
  const first = rejoins.track('first');
  const second = rejoins.track('second');
  const score = { name: 'paper', kills: 6, deaths: 2 };
  rejoins.disconnect('first', score);
  rejoins.disconnect('second', score);
  score.kills = 0;

  now = 89_999;
  expect(rejoins.previousId(first)).toBe('first');
  expect(rejoins.restore('first', 'replacement', undefined)).toEqual({
    name: 'paper',
    kills: 6,
    deaths: 2,
  });
  now = 90_000;
  expect(rejoins.previousId(second)).toBeUndefined();
  expect(rejoins.previousId(first)).toBe('replacement');
  rejoins.clear();
  expect(rejoins.previousId(first)).toBeUndefined();
});
