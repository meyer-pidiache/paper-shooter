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

/** Muted inks that remain distinct against night paper. */
export function createDarkInkColors(): Vector3[] {
  return [
    new Vector3(0.55, 0.62, 0.77),
    new Vector3(0.81, 0.47, 0.5),
    new Vector3(0.68, 0.7, 0.75),
    new Vector3(0.78, 0.63, 0.45),
    new Vector3(0.45, 0.69, 0.55),
    new Vector3(0.75, 0.53, 0.67),
  ];
}
