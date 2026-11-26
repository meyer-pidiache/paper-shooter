import { knownMap } from '../domain/maps';
import type { MapKey } from '../domain/maps';
import { cloneKeyBindings, normalizeKeyBindings } from '../shared/key-bindings.js';
import type { KeyBindings } from '../shared/key-bindings.js';
import { characterColor, type CharacterColor } from '../shared/character-color.js';

export interface SavedPreferences {
  mapKey: MapKey;
  best: number;
  checkpoint: number;
  musicWanted: boolean;
  myName: string;
  playerColor: CharacterColor;
  appearance: 'light' | 'dark';
  nerdStats: boolean;
  keyBindings: KeyBindings;
  settings: { sens: number; invert: boolean };
}
export interface PreferencePort {
  load(random?: () => number): SavedPreferences;
  write(key: string, value: string | number | boolean): void;
}

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function boundedNumber(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value.trim() === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

/** Reads old saves lazily and writes only the Paper namespace. Storage can be disabled by a browser. */
export class Preferences implements PreferencePort {
  constructor(private readonly storage: StoragePort | null) {}

  read(key: string): string | null {
    try {
      const current = this.storage?.getItem(`paper_${key}`);
      if (current != null) return current;
      const legacy = this.storage?.getItem(`doodle_${key}`) ?? null;
      if (legacy != null) this.write(key, legacy);
      return legacy;
    } catch {
      return null;
    }
  }

  write(key: string, value: string | number | boolean): void {
    try {
      this.storage?.setItem(`paper_${key}`, String(value));
    } catch {
      /* Gameplay remains usable when storage is unavailable or full. */
    }
  }

  load(random: () => number = Math.random): SavedPreferences {
    let keyBindings: KeyBindings = cloneKeyBindings();
    try {
      const saved = this.read('keyBindings');
      if (saved) keyBindings = normalizeKeyBindings(JSON.parse(saved));
    } catch {
      keyBindings = normalizeKeyBindings(null);
    }
    return {
      mapKey: knownMap(this.read('map')),
      best: boundedNumber(this.read('best'), 0, 0, Number.MAX_SAFE_INTEGER),
      checkpoint: Math.floor(boundedNumber(this.read('checkpoint'), 0, 0, 10000) / 5) * 5,
      musicWanted: this.read('music') !== '0',
      myName: this.read('name')?.slice(0, 14) || `paper${Math.floor(random() * 90 + 10)}`,
      playerColor: characterColor(this.read('playerColor')),
      appearance: this.read('appearance') === 'dark' ? 'dark' : 'light',
      nerdStats: this.read('nerdStats') === '1',
      keyBindings,
      settings: {
        sens: boundedNumber(this.read('sens'), 100, 25, 250),
        invert: this.read('invert') === '1',
      },
    };
  }
}

export function browserPreferences(): Preferences {
  try {
    return new Preferences(window.localStorage);
  } catch {
    return new Preferences(null);
  }
}
