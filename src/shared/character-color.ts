import { INK } from './ink.js';

export const CHARACTER_INKS = {
  original: INK.RED,
  blue: INK.BLUE,
  graphite: INK.BLACK,
  green: INK.GREEN,
  magenta: INK.MAGENTA,
  amber: INK.AMBER,
} as const;

export type CharacterColor = keyof typeof CHARACTER_INKS;
export const DEFAULT_CHARACTER_COLOR: CharacterColor = 'original';

export function characterColor(value: unknown): CharacterColor {
  return typeof value === 'string' && Object.hasOwn(CHARACTER_INKS, value)
    ? (value as CharacterColor)
    : DEFAULT_CHARACTER_COLOR;
}
