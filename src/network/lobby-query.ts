import { isRecord } from '../shared/ice.js';
import { decodeGameMessage } from './game-messages.js';
import type { GamePayloads } from './game-message-types.js';
import type { ConnectionPort, DiscoveryPeerPort } from './peer-ports.js';

const PUBLIC_PROBE_BATCH_SIZE = 16;
const PUBLIC_PROBE_BATCH_DELAY_MS = 750;

interface OfferConnection {
  hostId: string;
  connection: ConnectionPort;
}
export type WelcomeOffer = OfferConnection & { kind: 'welcome'; details: GamePayloads['welcome'] };
export type LobbyOffer =
  WelcomeOffer | (OfferConnection & { kind: 'refused'; details: GamePayloads['refused'] });
interface Attempt {
  hostId: string;
  connection: ConnectionPort;
  done: boolean;
  released?: boolean;
  challenged?: boolean;
  channelOpened: boolean;
  iceConnected: boolean;
  ice?: RTCPeerConnection | null;
  reportIce: () => void;
  opened: () => void;
  data: (value: unknown) => void;
  closed: () => void;
}
export type QuerySelection =
  { mode: 'all' } | { mode: 'first' | 'best'; adopt: (offer: WelcomeOffer) => void };
export type QueryOptions = QuerySelection & {
  timeout: number;
  gather: number;
  signal?: AbortSignal;
  onOffer?: (count: number) => void;
  rejoinToken?: (key: string) => string | undefined;
};

export class LobbyQueryError extends Error {
  constructor(
    readonly reason: 'empty' | 'timeout' | 'cancelled',
    message: string,
  ) {
    super(message);
  }
}

function close(connection: ConnectionPort): void {
  try {
    connection.close();
  } catch {
    /* An unfinished/failed connection may already be closed. */
  }
}

/** Owns one query's connections, event subscriptions and deadlines until selection/cancellation. */
export class LobbyQuery {
  private attempts: Attempt[] = [];
  private offers: LobbyOffer[] = [];
  private pending: number;
  private nextProbe = 0;
  private signalingReconnects = 0;
  private unavailable = 0;
  private failed = 0;
  private welcomed = 0;
  private refused = 0;
  private settled = false;
  private started = false;
  private timer?: ReturnType<typeof setTimeout>;
  private gatherTimer?: ReturnType<typeof setTimeout>;
  private batchTimer?: ReturnType<typeof setTimeout>;
  private lastError: Error | null = null;
  private resolve!: (offers: LobbyOffer[]) => void;
  private reject!: (error: Error) => void;

  constructor(
    private peer: DiscoveryPeerPort,
    private ids: string[],
    private metadata: object,
    private options: QueryOptions,
  ) {
    this.pending = ids.length;
  }

  get incomplete(): boolean {
    return this.pending > 0 || this.failed > 0;
  }

  get diagnostics() {
    return {
      slots: this.ids.length,
      unavailable: this.unavailable,
      pending: this.pending,
      queued: this.ids.length - this.nextProbe,
      signalingReconnects: this.signalingReconnects,
      failed: this.failed,
      iceConnected: this.attempts.filter((attempt) => attempt.iceConnected).length,
      channelsOpened: this.attempts.filter((attempt) => attempt.channelOpened).length,
      welcomed: this.welcomed,
      refused: this.refused,
    };
  }

  run(): Promise<LobbyOffer[]> {
    if (this.started) return Promise.reject(new Error('Lobby queries are single-use'));
    this.started = true;
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      if (this.options.signal?.aborted) {
        this.finish(new LobbyQueryError('cancelled', 'lobby operation cancelled'));
        return;
      }
      this.peer.on('error', this.onPeerError);
      this.options.signal?.addEventListener('abort', this.onAbort, { once: true });
      this.timer = setTimeout(() => this.finish(), this.options.timeout);
      this.launchBatch();
    });
  }

  private launchBatch(): void {
    if (this.settled) return;
    if (this.options.mode !== 'first' && this.peer.disconnected) {
      if (!this.peer.reconnect || this.signalingReconnects > 0) {
        this.finish();
        return;
      }
      this.signalingReconnects++;
      this.peer.on('open', this.onSignalReopened);
      try {
        this.peer.reconnect();
      } catch {
        this.finish();
      }
      return;
    }
    // Public discovery starts 64 PeerJS connections. Spread out ICE setup work.
    const end =
      this.options.mode === 'first'
        ? this.ids.length
        : Math.min(this.nextProbe + PUBLIC_PROBE_BATCH_SIZE, this.ids.length);
    while (!this.settled && this.nextProbe < end) this.probe(this.ids[this.nextProbe++]);
    if (this.settled) return;
    if (this.pending === 0) this.finish();
    else if (this.nextProbe < this.ids.length)
      this.batchTimer = setTimeout(() => this.launchBatch(), PUBLIC_PROBE_BATCH_DELAY_MS);
    else this.startGather();
  }

  private onSignalReopened = (): void => {
    this.peer.off('open', this.onSignalReopened);
    this.launchBatch();
  };

  private startGather(): void {
    if (this.nextProbe === this.ids.length && this.offers.length > 0)
      this.gatherTimer ??= setTimeout(() => this.finish(), this.options.gather);
  }

  private onAbort = (): void => {
    this.finish(new LobbyQueryError('cancelled', 'lobby operation cancelled'));
  };
  private onPeerError = (error: unknown): void => {
    if (!isRecord(error) || error.type !== 'peer-unavailable') return;
    const id = /peer\s+(\S+)/.exec(String(error.message ?? ''))?.[1];
    const attempt = this.attempts.find((candidate) => candidate.hostId === id);
    if (attempt && !attempt.done && !this.settled) {
      this.unavailable++;
      this.complete(attempt, true);
    }
  };

  private probe(hostId: string): void {
    let connection: ConnectionPort | undefined;
    try {
      connection = this.peer.connect(hostId, {
        reliable: true,
        serialization: 'json',
        metadata: this.metadata,
      });
    } catch {
      // A failed connect is inconclusive. Only an explicit unavailable signal proves absence.
    }
    if (!connection) {
      this.pending--;
      this.failed++;
      return;
    }
    const attempt: Attempt = {
      hostId,
      connection,
      done: false,
      channelOpened: connection.open,
      iceConnected: false,
      ice: connection.peerConnection,
      reportIce: () => {
        const state = attempt.ice?.iceConnectionState;
        if (state === 'connected' || state === 'completed') attempt.iceConnected = true;
      },
      opened: () => {
        attempt.channelOpened = true;
      },
      data: (value) => this.receive(attempt, value),
      closed: () => {
        if (this.options.mode !== 'all') {
          const before = this.offers.length;
          this.offers = this.offers.filter((offer) => offer.connection !== connection);
          if (this.offers.length < before) this.failed++;
        }
        if (!attempt.done && !this.settled) {
          this.failed++;
          this.complete(attempt);
        }
      },
    };
    this.attempts.push(attempt);
    attempt.reportIce();
    attempt.ice?.addEventListener('iceconnectionstatechange', attempt.reportIce);
    connection.on('open', attempt.opened);
    connection.on('data', attempt.data);
    connection.on('close', attempt.closed);
    connection.on('error', attempt.closed);
  }

  private complete(attempt: Attempt, release = false): void {
    attempt.done = true;
    this.pending--;
    if (release) {
      attempt.released = true;
      this.stopObserving(attempt);
      close(attempt.connection);
    }
    if (this.pending === 0) this.finish();
  }

  private receive(attempt: Attempt, value: unknown): void {
    if (attempt.done || this.settled) return;
    const message = decodeGameMessage(value);
    if (!message || (message.t !== 'welcome' && message.t !== 'refused')) return;
    attempt.channelOpened = true;
    if (message.t === 'welcome') this.welcomed++;
    else this.refused++;
    if (message.t === 'refused' && this.options.mode !== 'all') {
      this.lastError = new Error(message.d.reason);
      this.complete(attempt);
      return;
    }
    if (message.t === 'welcome' && this.options.rejoinToken) {
      if (!attempt.challenged) {
        const token = message.d.rejoinKey && this.options.rejoinToken(message.d.rejoinKey);
        if (!token) {
          this.complete(attempt);
          return;
        }
        attempt.challenged = true;
        attempt.connection.send({ t: 'stay', d: { token } });
        return;
      }
      if (message.d.rejoinKey) return;
    }
    attempt.done = true;
    this.pending--;
    const source = { hostId: attempt.hostId, connection: attempt.connection };
    this.offers.push(
      message.t === 'welcome'
        ? { ...source, kind: 'welcome', details: message.d }
        : { ...source, kind: 'refused', details: message.d },
    );
    try {
      this.options.onOffer?.(this.offers.length);
    } catch (failure) {
      this.finish(
        failure instanceof Error
          ? failure
          : new Error('lobby status callback failed', { cause: failure }),
      );
      return;
    }
    if (this.options.mode === 'first' || this.pending === 0) this.finish();
    else this.startGather();
  }

  private stopObserving(attempt: Attempt): void {
    attempt.reportIce();
    attempt.ice?.removeEventListener('iceconnectionstatechange', attempt.reportIce);
    attempt.connection.off('open', attempt.opened);
    attempt.connection.off('data', attempt.data);
    attempt.connection.off('close', attempt.closed);
    attempt.connection.off('error', attempt.closed);
  }

  private finish(error?: Error): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    clearTimeout(this.gatherTimer);
    clearTimeout(this.batchTimer);
    this.peer.off('error', this.onPeerError);
    this.peer.off('open', this.onSignalReopened);
    this.options.signal?.removeEventListener('abort', this.onAbort);
    for (const attempt of this.attempts) if (!attempt.released) this.stopObserving(attempt);
    // PeerJS clears disconnected when reconnect starts. Only open confirms signaling is ready.
    const signalLost = this.options.mode === 'best' && !this.peer.open;
    const winner = signalLost ? undefined : this.select();
    let adopted: ConnectionPort | undefined;
    try {
      // Install the session handler in this data-event turn so following packets cannot be lost.
      if (!error && winner && this.options.mode !== 'all') {
        this.options.adopt(winner);
        adopted = winner.connection;
      }
    } catch (failure) {
      error =
        failure instanceof Error
          ? failure
          : new Error('could not adopt the lobby', { cause: failure });
    }
    for (const attempt of this.attempts)
      if (!attempt.released && attempt.connection !== adopted) close(attempt.connection);
    if (error) this.reject(error);
    else if (this.options.mode !== 'all' && !adopted)
      this.reject(
        (
          this.options.mode === 'best'
            ? this.incomplete || signalLost
            : this.pending > 0 && !this.lastError
        )
          ? new LobbyQueryError('timeout', 'no answer from that lobby')
          : new LobbyQueryError('empty', this.lastError?.message ?? 'no lobby with that code'),
      );
    else this.resolve(this.offers);
  }

  private select(): WelcomeOffer | undefined {
    const open = this.offers.filter(
      (offer): offer is WelcomeOffer => offer.kind === 'welcome' && offer.connection.open,
    );
    if (this.options.mode === 'best')
      open.sort((a, b) => (b.details.players ?? 0) - (a.details.players ?? 0));
    return open[0];
  }
}
