import { LEVELS, type MapKey } from './maps.js';

export const MAP_VOTE_SECONDS = 20;

export interface MapBallot {
  id: string;
  map: MapKey;
}

export class MapVote {
  private ballots = new Map<string, MapKey>();
  private readonly eligible: Set<string>;

  constructor(
    readonly id: number,
    private readonly ranking: readonly string[],
    private readonly current: MapKey,
  ) {
    this.eligible = new Set(ranking);
  }

  cast(id: string, map: MapKey): boolean {
    if (!this.eligible.has(id) || this.ballots.get(id) === map) return false;
    this.ballots.set(id, map);
    return true;
  }

  receive(ballots: readonly MapBallot[]) {
    this.ballots = new Map(ballots.map(({ id, map }) => [id, map]));
  }

  get complete(): boolean {
    return this.ranking.length > 0 && this.ranking.every((id) => this.ballots.has(id));
  }

  get entries(): MapBallot[] {
    return Array.from(this.ballots, ([id, map]) => ({ id, map }));
  }

  get counts(): ReadonlyMap<MapKey, number> {
    const counts = new Map<MapKey, number>(LEVELS.map(({ key }) => [key, 0]));
    for (const map of this.ballots.values()) counts.set(map, (counts.get(map) ?? 0) + 1);
    return counts;
  }

  selection(id: string | null): MapKey | undefined {
    return id === null ? undefined : this.ballots.get(id);
  }

  winner(): MapKey {
    if (this.ballots.size === 0) return this.current;
    const counts = this.counts;
    const maximum = Math.max(...counts.values());
    for (const id of this.ranking) {
      const map = this.ballots.get(id);
      if (map !== undefined && counts.get(map) === maximum) return map;
    }
    return this.current;
  }
}
