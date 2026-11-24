import type { CombatPorts } from './combat-contracts.js';
import type { HitscanPorts } from '../gameplay/weapons/impact-contracts.js';
import type { PlayerServices, PlayerPresentation } from '../gameplay/player/services.js';
import type { GunServices, BladeServices } from '../gameplay/weapons/services.js';
import type { EnemySystemServices } from '../gameplay/enemies/system-contracts.js';
import type { FrameDisplayPorts } from '../presentation/frame.js';
import type { BrowserScreens } from '../presentation/screen-bindings.js';
import type { FocusMarker } from '../presentation/focus-marker.js';
import type { presentPickup } from '../presentation/pickups.js';
import type { createControls } from './controls.js';
import type { RunReset } from './run-reset.js';
import type { SessionPorts, SessionAudio } from './session-contracts.js';
import type { UserSettingsPorts } from './user-settings.js';
import type { LoopPorts } from './loop-contracts.js';
import type { MultiplayerPorts, MultiplayerTransport } from './multiplayer-contracts.js';
import type { MatchPorts } from './match-contracts.js';
import type { WavePorts } from './wave-contracts.js';
import type { FocusPorts } from './focus-contracts.js';
import type { FocusTarget } from '../gameplay/focus/contracts.js';
import type { ScreenPorts } from './screen-contracts.js';

type ControlPorts = Parameters<typeof createControls>[0];
type ResetPorts = ConstructorParameters<typeof RunReset>[0];
type ScreenHud = ConstructorParameters<typeof BrowserScreens>[0];
type MarkerHud = ConstructorParameters<typeof FocusMarker>[0]['hud'];
type PickupFeedback = Parameters<typeof presentPickup>[0];

/** Composition accepts capabilities actually consumed by the application, without adapter internals. */
export type ApplicationInput = PlayerServices['input'] &
  ControlPorts['input'] &
  LoopPorts['input'] &
  UserSettingsPorts['input'] &
  MultiplayerPorts['input'] &
  FocusPorts<FocusTarget>['input'] & {
    dispose?(): void;
    setKeyBindings?(bindings: import('../shared/key-bindings.js').KeyBindings): void;
    getKeyBindings?(): import('../shared/key-bindings.js').KeyBindings;
    updateBinding?(
      action: import('../shared/key-bindings.js').KeyBindingAction,
      device: import('../shared/key-bindings.js').BindingDevice,
      value: string | number,
    ): string | null;
    clearBinding?(
      action: import('../shared/key-bindings.js').KeyBindingAction,
      device: import('../shared/key-bindings.js').BindingDevice,
    ): void;
    resetKeyBindings?(): void;
    keyLabel?(action: string): string;
  };
export type ApplicationHud = PlayerPresentation['hud'] &
  EnemySystemServices['hud'] &
  FrameDisplayPorts['hud'] &
  LoopPorts['hud'] &
  MatchPorts['hud'] &
  WavePorts['hud'] &
  ControlPorts['hud'] &
  ScreenHud &
  MarkerHud &
  ResetPorts['hud'] &
  SessionPorts['hud'] &
  MultiplayerPorts['hud'] &
  PickupFeedback['hud'] & {
    el: { board: { readonly hidden: boolean } };
    onScreenChange?: (() => void) | null;
    setNerdStatsVisible?(visible: boolean): void;
    updateScoreboardHint?(): void;
  };
export type ApplicationAudio = PlayerPresentation['audio'] &
  CombatPorts['audio'] &
  Pick<HitscanPorts<unknown, unknown>['feedback'], 'ricochet'> &
  EnemySystemServices['audio'] &
  GunServices['audio'] &
  BladeServices['audio'] &
  SessionAudio &
  WavePorts['audio'] &
  FocusPorts<FocusTarget>['audio'] &
  FrameDisplayPorts['audio'] &
  MultiplayerPorts['audio'] &
  PickupFeedback['audio'] &
  LoopPorts['audio'] & {
    kill(strong?: boolean): void;
    readonly ctx: object | null;
    setTune(key: string): void;
    dispose(): void;
  };
export type ApplicationTransport = MultiplayerTransport &
  ScreenPorts['transport'] &
  SessionPorts['transport'] & {
    setNerdStatsEnabled?(enabled: boolean): void;
    getNerdPing?(): { value: number | null; label: string };
  };
