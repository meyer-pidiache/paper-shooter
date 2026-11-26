import { MAX_PLAYERS } from '../domain/match.js';
import { lobbyCode, lobbyCount } from './protocol.js';
import { LobbyQuery, LobbyQueryError } from './lobby-query.js';
import type { LobbyOffer, WelcomeOffer, QueryOptions, QuerySelection } from './lobby-query.js';
import type { GamePayloads } from './game-message-types.js';
import type { DiscoveryPeerPort } from './peer-ports.js';

export const PUBLIC_SLOT_COUNT = 16;
export interface LobbyListing {
  id: string;
  code: string;
  players: number;
  max: number;
  inMatch: boolean;
  hostName: string;
  full: boolean;
}
export interface LobbyBrowseResult {
  rows: LobbyListing[];
  incomplete: boolean;
}
interface DiscoveryDiagnostics {
  signaling: 'ready' | 'failed' | 'cancelled';
  signalingMs: number;
  probes: LobbyQuery['diagnostics'] | null;
}
type Status = (message: string) => void;
type Adopt = (peer: DiscoveryPeerPort, offer: WelcomeOffer) => void;

function publicIds(prefix: string): string[] {
  return Array.from({ length: PUBLIC_SLOT_COUNT }, (_, slot) =>
    ['', '-1', '-2', '-3'].map((suffix) => `${prefix}PUB${slot}${suffix}`),
  ).flat();
}
function listings(offers: LobbyOffer[], prefix: string): LobbyListing[] {
  const byCode = new Map<string, LobbyListing>();
  for (const offer of offers) {
    const details = offer.details;
    const code = lobbyCode(details.code, offer.hostId.slice(prefix.length)).replace(/-\d+$/, '');
    const row = {
      id: offer.hostId.slice(prefix.length),
      code,
      players: lobbyCount(details.players),
      max: lobbyCount(details.max, MAX_PLAYERS, 1),
      inMatch: !!details.inMatch,
      hostName: details.hostName ?? '',
      full: offer.kind === 'refused',
    };
    if (row.players > (byCode.get(code)?.players ?? -1)) byCode.set(code, row);
  }
  return [...byCode.values()].sort((a, b) => b.players - a.players);
}
function destroy(peer?: DiscoveryPeerPort): void {
  try {
    peer?.destroy();
  } catch {
    /* Failed signaling endpoints may already be destroyed. */
  }
}

/** Owns temporary signaling peers; only an explicit successful adoption transfers one to a session. */
export class LobbyDiscovery {
  private readonly operations = new Set<AbortController>();
  private latestOperation?: AbortController;
  private lastDiagnostics: DiscoveryDiagnostics | null = null;
  constructor(
    private openPeer: () => Promise<DiscoveryPeerPort>,
    private prefix: string,
  ) {}

  cancel(): void {
    for (const operation of this.operations) operation.abort();
  }
  get diagnostics(): DiscoveryDiagnostics | null {
    return this.lastDiagnostics;
  }
  private begin(): AbortController {
    this.cancel();
    const operation = new AbortController();
    this.operations.add(operation);
    this.latestOperation = operation;
    this.lastDiagnostics = null;
    return operation;
  }
  private async open(operation: AbortController): Promise<DiscoveryPeerPort> {
    const peer = await this.openPeer();
    if (operation.signal.aborted) {
      destroy(peer);
      throw new LobbyQueryError('cancelled', 'lobby operation cancelled');
    }
    return peer;
  }

  async browse(metadata: object, onStatus?: Status): Promise<LobbyBrowseResult> {
    const result = await this.query(metadata, () => ({
      mode: 'all',
      gather: 2200,
      onOffer: (count) => onStatus?.(`found ${count}…`),
    }));
    return { rows: listings(result.offers, this.prefix), incomplete: result.incomplete };
  }

  async join(
    metadata: object,
    adopt: Adopt,
    onStatus?: Status,
    prepareStay?: () => Promise<GamePayloads['stay']>,
  ): Promise<void> {
    let seating: Promise<void> | undefined;
    try {
      await this.query(metadata, (peer, transfer) => {
        onStatus?.('looking for an open lobby…');
        return {
          mode: 'best',
          gather: 1500,
          onOffer: (count) =>
            onStatus?.(`found ${count} open ${count === 1 ? 'lobby' : 'lobbies'}…`),
          adopt: (offer) => {
            adopt(peer, offer);
            transfer();
            if (!prepareStay) offer.connection.send({ t: 'stay' });
            else seating = prepareStay().then((d) => {
              if (!offer.connection.open)
                throw new LobbyQueryError('cancelled', 'lobby operation cancelled');
              offer.connection.send(d ? { t: 'stay', d } : { t: 'stay' });
            });
          },
        };
      });
      await seating;
    } catch (error) {
      if (error instanceof LobbyQueryError) {
        if (error.reason === 'empty') throw new LobbyQueryError('empty', 'no open public lobbies');
        if (error.reason === 'timeout')
          throw new LobbyQueryError('timeout', 'public lobby search did not finish');
      }
      throw error;
    }
  }

  private async query(
    metadata: object,
    options: (
      peer: DiscoveryPeerPort,
      transfer: () => void,
    ) => Pick<QueryOptions, 'gather' | 'onOffer'> & QuerySelection,
  ) {
    const operation = this.begin();
    const started = performance.now();
    let peer: DiscoveryPeerPort | undefined;
    let query: LobbyQuery | undefined;
    let signalingMs: number | undefined;
    let transferred = false;
    try {
      peer = await this.open(operation);
      signalingMs = Math.round(performance.now() - started);
      query = new LobbyQuery(
        peer,
        publicIds(this.prefix),
        { ...metadata, probe: true },
        {
          timeout: 11000,
          signal: operation.signal,
          ...options(peer, () => {
            transferred = true;
          }),
        },
      );
      const offers = await query.run();
      return { offers, incomplete: query.incomplete };
    } finally {
      if (this.latestOperation === operation) {
        this.lastDiagnostics = {
          signaling:
            signalingMs !== undefined ? 'ready' : operation.signal.aborted ? 'cancelled' : 'failed',
          signalingMs: signalingMs ?? Math.round(performance.now() - started),
          probes: query?.diagnostics ?? null,
        };
      }
      if (!transferred) destroy(peer);
      this.operations.delete(operation);
    }
  }
}
