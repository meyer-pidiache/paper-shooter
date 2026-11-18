import { formatClock, type Score, type Winner } from '../domain/match.js';
import type { GamePayloads } from '../network/game-message-types.js';
export interface MatchClockPorts {
  state: { matchLeft: number; clockRunning: boolean; clockT: number };
  game: { clockStarted: boolean; readonly over: unknown; matchT: number };
  transport: {
    readonly isHost: boolean;
    readonly id: string | null;
    send<K extends 'clock' | 'end'>(kind: K, data: GamePayloads[K]): void;
  };
  now(): number;
  inMatch(): boolean;
  opponentCount(): number;
  localName(): string;
  sortedScores(): Array<[string, Score]>;
  timer(text: string, urgent?: boolean): void;
  end(winner: Winner): void;
}
/** Host starts/finishes the clock; followers only project the last authoritative clock. */
export class MatchClock {
  private snapshotAt: number | null = null;

  constructor(private readonly ports: MatchClockPorts) {}
  receive(clock: GamePayloads['clock']) {
    if (this.ports.transport.isHost) return;
    this.ports.state.matchLeft = clock.left;
    this.ports.state.clockRunning = !!clock.on;
    this.snapshotAt = this.ports.now();
  }
  update(dt: number, frameAt = this.ports.now()) {
    const { state, game, transport, inMatch, opponentCount, timer } = this.ports;
    const snapshotAt = this.snapshotAt;
    if (transport.isHost || (snapshotAt !== null && frameAt >= snapshotAt)) this.snapshotAt = null;
    // An animation frame can carry a timestamp from before its callback was dispatched.
    const elapsed =
      !transport.isHost && snapshotAt !== null
        ? Math.min(dt, Math.max(0, (frameAt - snapshotAt) / 1000))
        : dt;
    if (transport.isHost && inMatch() && opponentCount() > 0) game.clockStarted = true;
    const on =
      inMatch() && !game.over && (transport.isHost ? !!game.clockStarted : state.clockRunning);
    if (inMatch() && !game.over) {
      if (on) state.matchLeft = Math.max(0, state.matchLeft - elapsed);
      if (transport.isHost) this.report(dt, on);
      const urgent = on && state.matchLeft <= 10;
      timer(
        on
          ? (urgent ? 'FINAL SECONDS · ' : '') + formatClock(state.matchLeft)
          : 'clock starts when someone joins',
        urgent,
      );
    }
    if (transport.isHost && on) {
      game.matchT += dt;
      if (state.matchLeft <= 0) this.finish();
    }
  }
  private report(dt: number, on: boolean) {
    const { state, transport } = this.ports;
    state.clockT -= dt;
    if (state.clockT <= 0) {
      state.clockT = 2;
      transport.send('clock', { left: state.matchLeft, on });
    }
  }
  private finish() {
    const { sortedScores, transport, localName, end } = this.ports;
    const id = transport.id;
    // Hosting may be elected before the replacement endpoint has opened.
    if (id === null) return;
    const first = sortedScores()[0];
    const winner: Winner = first
      ? { id: first[0], name: first[1].name }
      : { id, name: localName() };
    transport.send('end', winner);
    end(winner);
  }
}
