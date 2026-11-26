import type { MapKey } from '../domain/maps.js';
import type { MatchDuration, MatchMode, Team, Score } from '../domain/match.js';
export interface LobbyRowView {
  code: string;
  hostName: string;
  players: number;
  max: number;
  inMatch: boolean;
  full: boolean;
}
export interface LobbyListView {
  readonly busy: boolean;
  readonly rows: readonly LobbyRowView[] | null;
  readonly incomplete: boolean;
}
export type LobbyBrowseView = {
  rows: readonly LobbyRowView[];
  incomplete: boolean;
};
export interface MainScreenView {
  mapKey: MapKey;
  best: number;
  checkpoint: number;
}
export interface OnlineScreenView {
  myName: string;
  isPublic: boolean;
  status: string;
  rejoinCode?: string | null;
}
export interface LobbyScreenView {
  rows: readonly { id: string; name: string; team?: Team }[];
  mode?: MatchMode;
  host: boolean;
  code: string | null;
  localId: string | null;
  hostId: string | null;
  maxPlayers: number;
  mapKey: MapKey;
  mapLocked?: boolean;
  duration?: MatchDuration;
  isPublic: boolean;
  status: string;
}
export interface PauseScreenView {
  mode?: MatchMode;
  code: string;
  localId: string | null;
  scores: ReadonlyArray<readonly [string, Score]>;
}
export interface DeathScreenView {
  score: number;
  wave: number;
  kills: number;
  best: number;
  checkpoint: number;
}
