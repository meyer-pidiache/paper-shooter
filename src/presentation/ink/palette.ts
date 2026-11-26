import { Vector3 } from 'three';

const light = [
  [0.1, 0.19, 0.76],
  [0.86, 0.12, 0.2],
  [0.18, 0.2, 0.26],
  [0.92, 0.55, 0.08],
  [0.12, 0.6, 0.3],
  [0.9, 0.4, 0.66],
] as const;

// Muted inks that remain distinct against night paper.
const dark = [
  [0.55, 0.62, 0.77],
  [0.81, 0.47, 0.5],
  [0.68, 0.7, 0.75],
  [0.78, 0.63, 0.45],
  [0.45, 0.69, 0.55],
  [0.75, 0.53, 0.67],
] as const;

/** The renderer owns its palette values; ink identifiers live in shared/ink. */
export function createInkColors(): Vector3[] {
  return light.map(([r, g, b]) => new Vector3(r, g, b));
}

export function createDarkInkColors(): Vector3[] {
  return dark.map(([r, g, b]) => new Vector3(r, g, b));
}

export function inkCss(ink: number, appearance: 'light' | 'dark'): string {
  const rgb = (appearance === 'dark' ? dark : light)[ink];
  return `rgb(${rgb.map((channel) => Math.round(channel * 255)).join(', ')})`;
}
