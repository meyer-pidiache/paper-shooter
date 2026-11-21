import type { Score } from '../domain/match.js';
import { newRejoinSecret } from '../network/rejoin-credentials.js';

const REJOIN_GRACE_MS = 90_000;
type RejoinRecord = {
  id: string;
  pending?: { score: Score; expiresAt: number };
};

/** Keeps credentials and disconnected scores for the current host's active match. */
export class MatchRejoins {
  private readonly records = new Map<string, RejoinRecord>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  track(id: string): string {
    this.prune();
    const token = newRejoinSecret();
    this.records.set(token, { id });
    return token;
  }

  disconnect(id: string, score: Score | undefined): void {
    this.prune();
    for (const [token, record] of this.records) {
      if (record.id !== id) continue;
      if (score) record.pending = { score: { ...score }, expiresAt: this.now() + REJOIN_GRACE_MS };
      else this.records.delete(token);
      break;
    }
  }

  previousId(token: string): string | undefined {
    this.prune();
    return this.records.get(token)?.id;
  }

  restore(previous: string, id: string, liveScore: Score | undefined): Score | undefined {
    for (const record of this.records.values()) {
      if (record.id !== previous) continue;
      const score = record.pending?.score ?? liveScore;
      record.id = id;
      record.pending = undefined;
      return score;
    }
  }

  clear(): void {
    this.records.clear();
  }

  private prune(): void {
    const now = this.now();
    for (const [token, { pending }] of this.records)
      if (pending && pending.expiresAt <= now) this.records.delete(token);
  }
}
