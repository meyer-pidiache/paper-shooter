import type { LobbyBrowseView, LobbyListView } from '../presentation/screen-views-types.js';
interface BrowserPorts {
  active(): boolean;
  name(): string;
  fetch(name: string): Promise<LobbyBrowseView>;
  changed(error: unknown | null): void;
}
/** Owns browse cache, coalescing and publication lifetime; signaling endpoints belong to transport. */
export class LobbyBrowser {
  private disposed = false;
  private lastError: unknown = null;
  private readonly snapshot = {
    busy: false,
    rows: null as LobbyBrowseView['rows'] | null,
    incomplete: false,
  };
  constructor(private readonly ports: BrowserPorts) {}
  get view(): LobbyListView {
    return this.snapshot;
  }
  get error() {
    return this.lastError;
  }
  dispose() {
    this.disposed = true;
  }
  async refresh() {
    if (this.disposed || this.snapshot.busy || this.ports.active()) return;
    this.snapshot.busy = true;
    this.lastError = null;
    this.ports.changed(null);
    let result: LobbyBrowseView = { rows: [], incomplete: false },
      error: unknown = null;
    try {
      result = await this.ports.fetch(this.ports.name());
    } catch (reason) {
      error = reason;
    }
    if (this.disposed) return;
    this.snapshot.rows = result.rows;
    this.snapshot.incomplete = result.incomplete;
    this.snapshot.busy = false;
    this.lastError = error;
    this.ports.changed(error);
  }
}
