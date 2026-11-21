const STORAGE_KEY = 'paper_match_rejoins';
const MAX_SAVED_LOBBIES = 16;

export function newRejoinSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isRejoinSecret(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}

export interface RejoinCredential {
  hostId: string;
  key: string;
  token: string;
}

type SavedCredential = RejoinCredential & { code: string };

function isSavedCredential(value: unknown): value is SavedCredential {
  if (value === null || typeof value !== 'object') return false;
  const { code, hostId, key, token } = value as Partial<SavedCredential>;
  return (
    typeof code === 'string' &&
    typeof hostId === 'string' &&
    isRejoinSecret(key) &&
    isRejoinSecret(token)
  );
}

export class RejoinCredentials {
  private saved: SavedCredential[] = [];

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null) {}

  private read(): SavedCredential[] {
    try {
      const data: unknown = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? 'null');
      if (Array.isArray(data)) return data.filter(isSavedCredential);
    } catch {
      // A blocked or damaged save falls back to credentials from this page.
    }
    return this.saved;
  }

  get(code: string): RejoinCredential | undefined {
    const base = code.replace(/-\d+$/, '');
    return this.read().find((entry) => entry.code === base);
  }

  save(code: string, credential: RejoinCredential): void {
    const base = code.replace(/-\d+$/, '');
    this.saved = [
      { ...credential, code: base },
      ...this.read().filter((entry) => entry.code !== base),
    ].slice(0, MAX_SAVED_LOBBIES);
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.saved));
    } catch {
      // Rejoining from the current page still works when storage is unavailable.
      this.storage = null;
    }
  }
}

export function browserRejoinCredentials(): RejoinCredentials {
  try {
    return new RejoinCredentials(globalThis.localStorage ?? null);
  } catch {
    return new RejoinCredentials(null);
  }
}
