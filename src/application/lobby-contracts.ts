import type { MapKey } from '../domain/maps.js';
import type { MatchDuration, Score } from '../domain/match.js';
export interface LobbyState {
  players: Map<string, { name: string }>;
  hostId: string | null;
  isPublic: boolean;
  status: string;
  code: string;
  map: MapKey | null;
  mapLocked?: boolean;
  duration?: MatchDuration;
  order?: string[];
  gen?: number;
  shown?: string | null;
  rejoinCode?: string | null;
  migrationPeers?: Set<string>;
}
export interface LobbyTransport {
  readonly id: string | null;
  readonly code: string | null;
  readonly isPublic: boolean;
  readonly inMatch?: boolean;
  accepting: boolean;
  onAlias: (() => void) | null;
  host(options: { isPublic: boolean; code?: string }): Promise<unknown>;
  join(code: string, metadata: { name: string; prev?: string }): Promise<unknown>;
  quickJoin(metadata: { name: string }, status: (message: string) => void): Promise<unknown>;
  leave(): void;
  claimAlias(code: string): void;
}
export interface LobbyConnectionPorts {
  transport: LobbyTransport;
  lobby: LobbyState;
  scores: Map<string, Score>;
  local: { myName: string; mapKey: MapKey };
  removeRemote(id: string): void;
  remoteIds(): Iterable<string>;
  inMatch(): boolean;
  broadcastLobby(): void;
  session: {
    enterLobby(): void;
    returnOnline(): void;
    takeClockAuthority(): void;
    recoverHost(wasInMatch: boolean): void;
    recoverFollower(wasInMatch: boolean): void;
  };
  presentation: {
    status(message: string): void;
    unlockButtons(): void;
    message(title: string, detail: string, duration: number): void;
    feed(message: string): void;
  };
}

export interface HostMigrationPorts extends Pick<
  LobbyConnectionPorts,
  'lobby' | 'scores' | 'removeRemote' | 'inMatch' | 'broadcastLobby'
> {
  transport: Pick<
    LobbyTransport,
    'id' | 'code' | 'accepting' | 'onAlias' | 'host' | 'join' | 'claimAlias' | 'leave'
  >;
  local: Pick<LobbyConnectionPorts['local'], 'myName'>;
  session: Pick<
    LobbyConnectionPorts['session'],
    'takeClockAuthority' | 'recoverHost' | 'recoverFollower'
  >;
  presentation: Pick<LobbyConnectionPorts['presentation'], 'message' | 'feed'>;
}
