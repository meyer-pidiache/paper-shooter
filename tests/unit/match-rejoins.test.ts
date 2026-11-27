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

it('carries an absolute deadline and exact bank attribution through replica promotion', () => {
  const verifier = '04' + 'ab'.repeat(64);
  let now = 100_000;
  const host = new MatchRejoins(
    () => now,
    () => now,
  );
  host.startTeams();
  const match = host.match!;
  expect(host.bind('departed', verifier)).toBe(true);
  const score = { name: 'paper', team: 'blue' as const, kills: 4, deaths: 2 };
  host.disconnect('departed', score);
  now += 80_000;
  const successor = new MatchRejoins(
    () => now,
    () => now,
  );
  successor.receive({ match, bindings: host.snapshot(), scores: [] });
  expect(successor.previousId(verifier)).toBeUndefined();
  expect(successor.proofId('other match', verifier)).toBeUndefined();
  expect(successor.proofId(match, verifier)).toBe('departed');
  expect(successor.snapshot()[0].pending).toEqual({ expiresAt: 190_000, score });
  now += 10_000;
  expect(successor.proofId(match, verifier)).toBeUndefined();
  expect(successor.snapshot()).toEqual([]);

  successor.clear();
  successor.startTeams();
  expect(successor.match).not.toBe(match);
  expect(successor.bind('new peer', verifier)).toBe(true);
  expect(successor.proofId(match, verifier)).toBeUndefined();
  successor.rekey('new peer', 'promoted peer');
  expect(successor.proofId(successor.match!, verifier)).toBe('promoted peer');
  expect(successor.snapshot()[0].pending).toBeUndefined();
});
