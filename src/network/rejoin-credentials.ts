import { isRejoinKeyPair, type RejoinKeyPair } from './rejoin-proof.js';

const STORAGE_KEY = 'paper_match_rejoins';
const MAX_SAVED_LOBBIES = 16;
const baseCode = (code: string) => code.replace(/-\d+$/, '');

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

export interface PortableRejoinCredential extends RejoinKeyPair {
  match: string;
  hostId: string;
}

export interface MigrationRejoin {
  key: RejoinKeyPair;
  binding?: PortableRejoinCredential;
}

type SavedProof = PortableRejoinCredential & { code: string };
type SavedToken = RejoinCredential & { code: string };
type SavedCredential = SavedToken | SavedProof;

function isSavedProof(value: unknown): value is SavedProof {
  if (!isRejoinKeyPair(value)) return false;
  const { code, hostId, match } = value as Partial<SavedProof>;
  return typeof code === 'string' && typeof hostId === 'string' && isRejoinSecret(match);
}

function isSavedToken(value: unknown): value is SavedToken {
  if (value === null || typeof value !== 'object') return false;
  const { code, hostId, key, token } = value as Partial<SavedToken>;
  return (
    typeof code === 'string' &&
    typeof hostId === 'string' &&
    isRejoinSecret(key) &&
    isRejoinSecret(token)
  );
}

function sameProofBinding(
  entry: SavedCredential | undefined,
  credential: PortableRejoinCredential,
): entry is SavedProof {
  return (
    !!entry &&
    'match' in entry &&
    entry.match === credential.match &&
    entry.hostId === credential.hostId &&
    entry.verifier === credential.verifier
  );
}

function publicEntry({ code, hostId }: SavedCredential, prefix: string, slotCount: number) {
  return (
    /^PUB(?:0|[1-9]\d*)$/.test(code) &&
    Number(code.slice(3)) < slotCount &&
    hostId.startsWith(prefix) &&
    baseCode(hostId.slice(prefix.length)) === code
  );
}

export class RejoinCredentials {
  private saved: SavedCredential[] = [];

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null) {}

  private read(): SavedCredential[] {
    try {
      const data: unknown = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? 'null');
      if (Array.isArray(data))
        return data.filter((entry) => isSavedProof(entry) || isSavedToken(entry));
    } catch {
      // A blocked or damaged save falls back to credentials from this page.
    }
    return this.saved;
  }

  get(code: string): RejoinCredential | undefined {
    return this.read()
      .filter(isSavedToken)
      .find((entry) => entry.code === baseCode(code));
  }

  getProof(code: string): PortableRejoinCredential | undefined {
    return this.read()
      .filter(isSavedProof)
      .find((entry) => entry.code === baseCode(code));
  }

  latestPublic(prefix: string, slotCount: number): RejoinCredential | undefined {
    return this.read()
      .filter(isSavedToken)
      .find((entry) => publicEntry(entry, prefix, slotCount));
  }

  latestPublicRecovery(prefix: string, slotCount: number): SavedCredential | undefined {
    return this.read().find((entry) => publicEntry(entry, prefix, slotCount));
  }

  saveProof(code: string, credential: PortableRejoinCredential): void {
    const base = baseCode(code);
    const entries = this.read();
    const previous = entries.find((entry) => entry.code === base);
    if (sameProofBinding(previous, credential)) return;
    this.saveEntry({ ...credential, code: base }, entries);
  }

  markProofPlayed(code: string, credential: PortableRejoinCredential): void {
    const base = baseCode(code);
    const entries = this.read();
    const previous = entries.find((entry) => entry.code === base);
    if (previous !== entries[0] && sameProofBinding(previous, credential))
      this.saveEntry(previous, entries);
  }

  save(code: string, credential: RejoinCredential): void {
    this.saveEntry({ ...credential, code: baseCode(code) }, this.read());
  }

  private saveEntry(entry: SavedCredential, entries: SavedCredential[]): void {
    this.saved = [entry, ...entries.filter(({ code }) => code !== entry.code)].slice(
      0,
      MAX_SAVED_LOBBIES,
    );
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
