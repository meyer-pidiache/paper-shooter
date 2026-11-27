import { expect, it, vi } from 'vitest';
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
  expect(rejoins.tokenSeat(first)?.id).toBe('first');
  expect(rejoins.restore('first', 'replacement', undefined)).toEqual({
    name: 'paper',
    kills: 6,
    deaths: 2,
  });
  now = 90_000;
  expect(rejoins.tokenSeat(second)).toBeUndefined();
  expect(rejoins.tokenSeat(first)?.id).toBe('replacement');
  rejoins.clear();
  expect(rejoins.tokenSeat(first)).toBeUndefined();
});

it.each(['token', 'proof'] as const)(
  'restores a seat with both credentials once when it first returns by %s',
  (first) => {
    const verifier = '04' + 'ab'.repeat(64);
    const rejoins = new MatchRejoins(
      () => 123,
      () => 100_000,
    );
    rejoins.startTeams();
    const match = rejoins.match!;
    const token = rejoins.track('departed');
    expect(rejoins.bind('departed', verifier)).toBe(true);
    const score = { name: 'paper', team: 'blue' as const, kills: 4, deaths: 2 };
    rejoins.disconnect('departed', score);
    expect(rejoins.snapshot()).toEqual([
      { id: 'departed', verifier, pending: { score, expiresAt: 190_000 } },
    ]);
    const debits: [string, number][] = [];
    const debit = (team: string, kills: number) => debits.push([team, kills]);
    const resolve = {
      token: () => {
        const seat = rejoins.tokenSeat(token);
        seat?.bindVerifier(first === 'token' ? undefined : verifier);
        return seat?.id;
      },
      proof: () => rejoins.proofId(match, verifier),
    };

    const previous = resolve[first]();
    expect(previous).toBe('departed');
    expect(rejoins.restore(previous!, 'returning', undefined, debit)).toEqual(score);
    expect(rejoins.snapshot()).toEqual([{ id: 'returning', verifier }]);
    expect(rejoins.tokenSeat(token)?.id).toBe('returning');
    expect(rejoins.proofId(match, verifier)).toBe('returning');
    expect(rejoins.bind('returning', '04' + 'cd'.repeat(64))).toBe(false);
    const alternate = first === 'token' ? 'proof' : 'token';
    expect(rejoins.restore(resolve[alternate]()!, 'replacement', score, debit)).toEqual(score);
    expect(rejoins.tokenSeat(token)?.id).toBe('replacement');
    expect(rejoins.proofId(match, verifier)).toBe('replacement');
    expect(debits).toEqual([['blue', 4]]);
  },
);

it.each([
  'rekey',
  'rekey away and back',
  'unconfirmed restore',
  'handoff to another client',
  'replaced lineage',
  'expiry',
])('does not authorize an outstanding proof seat after %s', (change) => {
  const verifier = '04' + 'ab'.repeat(64);
  let now = 0;
  const rejoins = new MatchRejoins(
    () => now,
    () => now,
  );
  rejoins.startTeams();
  const match = rejoins.match!;
  expect(rejoins.bind('departed', verifier)).toBe(true);
  const score = { name: 'paper', team: 'blue' as const, kills: 4, deaths: 2 };
  const debit = vi.fn();
  const challenge = rejoins.proofSeat(match, verifier)!;
  switch (change) {
    case 'rekey':
      rejoins.rekey('departed', 'returning');
      break;
    case 'rekey away and back':
      rejoins.rekey('departed', 'other');
      rejoins.rekey('other', 'departed');
      break;
    case 'unconfirmed restore':
      expect(rejoins.restore('departed', 'returning', score, debit)).toEqual(score);
      break;
    case 'handoff to another client': {
      const claim = challenge.authorize('other')!;
      expect(rejoins.restore(claim.previous, 'other', score, debit)).toEqual(score);
      claim.confirm();
      expect(challenge.authorize('other')?.previous).toBe('other');
      break;
    }
    case 'replaced lineage':
      rejoins.receive({ match, bindings: rejoins.snapshot(), scores: [] });
      break;
    case 'expiry':
      rejoins.disconnect('departed', score);
      now = 90_000;
      break;
  }
  const before = rejoins.snapshot();
  expect(challenge.authorize('returning')).toBeUndefined();
  expect(rejoins.snapshot()).toEqual(before);
  expect(debit).not.toHaveBeenCalled();
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
  expect(successor.tokenSeat(verifier)).toBeUndefined();
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
