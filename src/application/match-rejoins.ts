import type { Score, Team } from '../domain/match.js';
import type { RejoinBinding, TeamsRejoinSnapshot } from '../network/game-message-types.js';
import { newRejoinSecret } from '../network/rejoin-credentials.js';
import { isRejoinVerifier, MAX_REJOIN_BINDINGS } from '../network/rejoin-proof.js';

const REJOIN_GRACE_MS = 90_000;
type SeatChange = { revision: number; kind: 'rekey' | 'restore' | 'proof-handoff' };
type RejoinRecord = {
  id: string;
  change?: SeatChange;
  pending?: NonNullable<RejoinBinding['pending']> & { tokenExpiresAt?: number };
};

export interface ProofSeat {
  readonly id: string;
  authorize(client: string): { previous: string; confirm(): void } | undefined;
}

/** Legacy tokens stay host-local; Teams replicas receive only match-scoped public bindings. */
export class MatchRejoins {
  private readonly records = new Map<string, RejoinRecord>();
  private readonly bindings = new Map<string, RejoinRecord>();
  match?: string;

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly wallNow: () => number = Date.now,
  ) {}

  startTeams(): void {
    this.match = newRejoinSecret();
  }

  bind(id: string, verifier: unknown): boolean {
    if (
      !this.match ||
      !isRejoinVerifier(verifier) ||
      this.protectedId(id) ||
      this.bindings.has(verifier) ||
      this.bindings.size >= MAX_REJOIN_BINDINGS
    )
      return false;
    // Both credentials address the same seat and its single pending score claim.
    this.bindings.set(verifier, this.find(id) ?? { id });
    return true;
  }

  protectedId(id: string): boolean {
    this.prune();
    return [...this.bindings.values()].some((record) => record.id === id);
  }

  proofId(match: string, verifier: string): string | undefined {
    return this.proofRecord(match, verifier)?.id;
  }

  /** Captures host-local seat lineage, not just a peer ID that can change or be reused. */
  proofSeat(match: string, verifier: string): ProofSeat | undefined {
    const record = this.proofRecord(match, verifier);
    if (!record) return;
    const revision = record.change?.revision ?? 0;
    return {
      id: record.id,
      authorize: (client) => {
        if (this.proofRecord(match, verifier) !== record) return;
        const current = record.change?.revision ?? 0;
        // A standby for this client may follow only the exact transition made by its
        // already verified sibling. Replicated state and unrelated moves never qualify.
        if (
          current !== revision &&
          (current !== revision + 1 ||
            record.change?.kind !== 'proof-handoff' ||
            record.id !== client)
        )
          return;
        return {
          previous: record.id,
          confirm: () => {
            const change = record.change;
            if (
              this.proofRecord(match, verifier) === record &&
              record.id === client &&
              change?.revision === current + 1 &&
              change.kind === 'restore'
            )
              change.kind = 'proof-handoff';
          },
        };
      },
    };
  }

  private proofRecord(match: string, verifier: string): RejoinRecord | undefined {
    this.prune();
    if (match === this.match) return this.bindings.get(verifier);
  }

  snapshot(): RejoinBinding[] {
    this.prune();
    return Array.from(this.bindings, ([verifier, { id, pending }]) => ({
      id,
      verifier,
      ...(pending ? { pending: { score: pending.score, expiresAt: pending.expiresAt } } : {}),
    }));
  }

  receive(snapshot: TeamsRejoinSnapshot | undefined): void {
    this.clear();
    if (!snapshot) return;
    this.match = snapshot.match;
    // Expiry is an absolute timestamp, not a fresh grace period on every reception or migration.
    for (const { verifier, id, pending } of snapshot.bindings) {
      this.bindings.set(verifier, {
        id,
        ...(pending
          ? {
              pending: {
                expiresAt: pending.expiresAt,
                score: {
                  name: pending.score.name,
                  team: pending.score.team,
                  kills: pending.score.kills,
                  deaths: pending.score.deaths,
                },
              },
            }
          : {}),
      });
    }
    this.prune();
  }

  rekey(previous: string, id: string): void {
    const record = this.find(previous);
    if (record && !record.pending) this.move(record, id, 'rekey');
  }

  track(id: string): string {
    this.prune();
    const token = newRejoinSecret();
    this.records.set(token, this.find(id) ?? { id });
    return token;
  }

  disconnect(id: string, score: Score | undefined): void {
    this.prune();
    const record = this.find(id);
    if (!record || record.pending) return;
    if (score) {
      record.pending = {
        score: { ...score },
        expiresAt: this.wallNow() + REJOIN_GRACE_MS,
        tokenExpiresAt: this.now() + REJOIN_GRACE_MS,
      };
    } else {
      for (const records of [this.bindings, this.records]) {
        for (const [key, candidate] of records) if (candidate === record) records.delete(key);
      }
    }
  }

  previousId(token: string): string | undefined {
    this.prune();
    return this.records.get(token)?.id;
  }

  /** Called synchronously after the transport authorizes a seat with a token or proof. */
  restore(
    previous: string,
    id: string,
    liveScore: Score | undefined,
    debit?: (team: Team, kills: number) => void,
  ): Score | undefined {
    const record = this.find(previous);
    if (!record) return;
    const pending = record.pending?.score;
    this.move(record, id, 'restore');
    record.pending = undefined;
    if (pending?.team) debit?.(pending.team, pending.kills);
    return pending ?? liveScore;
  }

  private move(record: RejoinRecord, id: string, kind: 'rekey' | 'restore'): void {
    if (record.id === id) return;
    record.id = id;
    record.change = { revision: (record.change?.revision ?? 0) + 1, kind };
  }

  private find(id: string): RejoinRecord | undefined {
    for (const records of [this.bindings, this.records]) {
      for (const record of records.values()) if (record.id === id) return record;
    }
  }

  clear(): void {
    this.records.clear();
    this.bindings.clear();
    this.match = undefined;
  }

  private prune(): void {
    for (const records of [this.bindings, this.records]) {
      const portable = records === this.bindings;
      const now = portable ? this.wallNow() : this.now();
      for (const [key, { pending }] of records)
        if (pending && (portable ? pending.expiresAt : (pending.tokenExpiresAt ?? 0)) <= now)
          records.delete(key);
    }
  }
}
