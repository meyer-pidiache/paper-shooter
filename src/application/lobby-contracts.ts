import type { MapKey } from '../domain/maps.js';
import type { MatchDuration, MatchMode, Team, Score } from '../domain/match.js';
import type { CharacterColor } from '../shared/character-color.js';
import type { MigrationRejoin } from '../network/rejoin-credentials.js';

type PlayerProfile = {
  name: string;
  color?: CharacterColor;
};
export interface LobbyState {
  players: Map<string, PlayerProfile & { team?: Team }>;
  mode?: MatchMode;
  teamBank?: Record<Team, number>;
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
  join(
    code: string,
    metadata: PlayerProfile & { prev?: string },
    migration?: MigrationRejoin,
  ): Promise<unknown>;
  migrationRejoin?(): MigrationRejoin | undefined;
  quickJoin(metadata: PlayerProfile, status: (message: string) => void): Promise<unknown>;
  leave(): void;
  claimAlias(code: string): void;
}
export interface LobbyConnectionPorts {
  transport: LobbyTransport;
  lobby: LobbyState;
  scores: Map<string, Score>;
  local: { myName: string; mapKey: MapKey; playerColor: CharacterColor };
  removeRemote(id: string): void;
  reconcileRejoin?(previous: string, current?: string): void;
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
  'lobby' | 'scores' | 'removeRemote' | 'reconcileRejoin' | 'inMatch' | 'broadcastLobby'
> {
  transport: Pick<
    LobbyTransport,
    | 'id'
    | 'code'
    | 'accepting'
    | 'onAlias'
    | 'host'
    | 'join'
    | 'migrationRejoin'
    | 'claimAlias'
    | 'leave'
  >;
  local: Pick<LobbyConnectionPorts['local'], 'myName' | 'playerColor'>;
  session: Pick<
    LobbyConnectionPorts['session'],
    'takeClockAuthority' | 'recoverHost' | 'recoverFollower'
  >;
  presentation: Pick<LobbyConnectionPorts['presentation'], 'message' | 'feed'>;
}
