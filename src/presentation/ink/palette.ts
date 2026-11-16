import { Vector3 } from 'three';

/** The renderer owns its palette values; ink identifiers live in shared/ink. */
export function createInkColors(): Vector3[] {
  return [
    new Vector3(0.1, 0.19, 0.76),
    new Vector3(0.86, 0.12, 0.2),
    new Vector3(0.18, 0.2, 0.26),
    new Vector3(0.92, 0.55, 0.08),
    new Vector3(0.12, 0.6, 0.3),
    new Vector3(0.9, 0.4, 0.66),
  ];
}

/** Pastel inks selected for contrast against the night-paper palette. */
export function createDarkInkColors(): Vector3[] {
  return [
    new Vector3(0.56, 0.68, 1),
    new Vector3(1, 0.43, 0.5),
    new Vector3(0.78, 0.83, 0.94),
    new Vector3(1, 0.72, 0.36),
    new Vector3(0.42, 0.87, 0.64),
    new Vector3(0.98, 0.62, 0.84),
  ];
}
