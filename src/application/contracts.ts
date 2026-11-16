import type {
  ApplicationInput,
  ApplicationHud,
  ApplicationAudio,
  ApplicationTransport,
} from './adapter-ports.js';
import type { PerspectiveCamera, Scene } from 'three';
import type { PreferencePort } from '../platform/preferences.js';

export interface RenderingPort {
  scene: Scene;
  camera: PerspectiveCamera;
  render(
    time: number,
    effects?: { hurt?: number; flash?: number; slow?: number; lowHp?: number },
  ): void;
  setDarkMode?(enabled: boolean): void;
  dispose(): void;
}

export interface ApplicationOptions {
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
  renderer?: RenderingPort;
  input?: ApplicationInput;
  hud?: ApplicationHud;
  preferences?: PreferencePort;
  net?: ApplicationTransport;
  audio?: ApplicationAudio;
  autoStart?: boolean;
}
