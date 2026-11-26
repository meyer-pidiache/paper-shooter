import type { CharacterColor } from '../shared/character-color.js';

export type KillFeedEntry =
  | string
  | {
      readonly before?: string;
      readonly killer: string;
      readonly color?: CharacterColor;
      readonly after: string;
    };
