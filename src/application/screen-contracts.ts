import type { MapKey } from '../domain/maps.js';
import type { GamePhase, Score } from '../domain/match.js';
import type { LobbyState } from './lobby-contracts.js';
import type { ScreenEvents, ScreenBindingMode } from '../presentation/screen-bindings.js';
import type { LobbyBrowseView } from '../presentation/screen-views-types.js';
export interface ScreenViewPort {
  settingsHTML(): string;
  confirm(): string;
  show(html: string): void;
  gameplay(visible: boolean): void;
  bind(mode: ScreenBindingMode, actions: ScreenEvents): void;
  status(message: string): void;
  rows(html: string): void;
  unlockButtons(): void;
}
export interface ScreenPorts {
  navigation: { screen: 'main' | 'online' | 'lobby' };
  profile: { readonly mapKey: MapKey; readonly myName: string };
  game: {
    readonly state: GamePhase;
    readonly wave: number;
    readonly kills: number;
    readonly score: number;
  };
  lobby: Pick<
    LobbyState,
    'map' | 'hostId' | 'isPublic' | 'status' | 'rejoinCode' | 'shown' | 'duration'
  >;
  transport: {
    readonly id: string | null;
    readonly code: string | null;
    readonly aliasCode?: string | null;
    readonly isHost: boolean;
    readonly active: boolean;
    readonly maxPlayers: number;
    listLobbies(metadata: { name: string }): Promise<LobbyBrowseView>;
    send(kind: 'startreq', data: Record<string, never>): void;
  };
  records: {
    readonly best: number;
    readonly checkpoint: number;
    recordBest(score: number): boolean;
  };
  view: ScreenViewPort;
  online(): boolean;
  selectMap(map: MapKey): void;
  actions: {
    cancelPending(): void;
    lobbyRows(): readonly { id: string; name: string }[];
    friendlyError(error: unknown): string;
    quickPlay(): void;
    createLobby(isPublic: boolean): void;
    setStatus(message: string): void;
    joinLobby(code: string): void;
    broadcastLobby(): void;
    hostStart(): void;
    leaveOnline(reason: string): void;
    beginAtWave(wave: number): void;
    begin(): void;
    sortedScores(): ReadonlyArray<readonly [string, Score]>;
    toMainMenu(): void;
  };
}
