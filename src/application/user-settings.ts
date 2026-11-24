import type { SavedPreferences, PreferencePort } from '../platform/preferences.js';
import type { MapKey } from '../domain/maps.js';
import type { BindingDevice, KeyBindingAction, KeyBindings } from '../shared/key-bindings.js';

export type UserSettingsState = Pick<
  SavedPreferences,
  'settings' | 'musicWanted' | 'myName' | 'mapKey' | 'appearance' | 'nerdStats' | 'keyBindings'
>;
export interface UserSettingsPorts {
  state: UserSettingsState;
  preferences: Pick<PreferencePort, 'write'>;
  input: {
    mouseSens: number;
    padSensX: number;
    padSensY: number;
    invertY: boolean;
    setKeyBindings?(bindings: KeyBindings): void;
    getKeyBindings?(): KeyBindings;
    updateBinding?(
      action: KeyBindingAction,
      device: BindingDevice,
      value: string | number,
    ): string | null;
    clearBinding?(action: KeyBindingAction, device: BindingDevice): void;
    resetKeyBindings?(): void;
    keyLabel?(action: string): string;
    exitLock?(): void;
  };
  audio: { musicOn(playing: boolean): void };
  player: { name: string };
  transport: { hostName: string; setNerdStatsEnabled?(enabled: boolean): void };
  setAppearance?(appearance: 'light' | 'dark'): void;
  setNerdStatsVisible?(visible: boolean): void;
  onBindingsChanged?(): void;
}
/** Owns persisted user edits and adapter synchronization; no screen or DOM access. */
export class UserSettings {
  constructor(private readonly ports: UserSettingsPorts) {}
  applyInitial() {
    const { state, input, transport, setAppearance } = this.ports;
    input.setKeyBindings?.(state.keyBindings);
    setAppearance?.(state.appearance);
    transport.setNerdStatsEnabled?.(state.nerdStats);
    this.ports.setNerdStatsVisible?.(state.nerdStats);
    this.applyLook();
  }
  applyLook() {
    const { state, input, preferences } = this.ports;
    const settings = state.settings;
    input.mouseSens = (0.0022 * settings.sens) / 100;
    input.padSensX = (3.4 * settings.sens) / 100;
    input.padSensY = (2.6 * settings.sens) / 100;
    input.invertY = settings.invert;
    preferences.write('sens', settings.sens);
    preferences.write('invert', settings.invert ? '1' : '0');
  }
  setSensitivity(value: number) {
    this.ports.state.settings.sens = value;
    this.applyLook();
  }
  setInvert(value: boolean) {
    this.ports.state.settings.invert = value;
    this.applyLook();
  }
  setMusic(value: boolean) {
    const { state, preferences, audio } = this.ports;
    state.musicWanted = value;
    preferences.write('music', state.musicWanted ? '1' : '0');
    audio.musicOn(state.musicWanted);
  }
  setAppearance(value: 'light' | 'dark') {
    const { state, preferences, setAppearance } = this.ports;
    state.appearance = value === 'dark' ? 'dark' : 'light';
    preferences.write('appearance', state.appearance);
    setAppearance?.(state.appearance);
  }
  setNerdStats(value: boolean) {
    const { state, preferences, transport, setNerdStatsVisible } = this.ports;
    state.nerdStats = !!value;
    preferences.write('nerdStats', state.nerdStats ? '1' : '0');
    transport.setNerdStatsEnabled?.(state.nerdStats);
    setNerdStatsVisible?.(state.nerdStats);
  }
  getKeyBindings() {
    return this.ports.input.getKeyBindings?.() ?? this.ports.state.keyBindings;
  }
  keyLabel(action: string) {
    return this.ports.input.keyLabel?.(action) ?? action;
  }
  setBinding(action: KeyBindingAction, device: BindingDevice, value: string | number) {
    const conflict = this.ports.input.updateBinding?.(action, device, value) ?? null;
    if (!conflict) this.saveBindings();
    return conflict;
  }
  clearBinding(action: KeyBindingAction, device: BindingDevice) {
    this.ports.input.clearBinding?.(action, device);
    this.saveBindings();
  }
  resetKeyBindings() {
    this.ports.input.resetKeyBindings?.();
    this.saveBindings();
  }
  private saveBindings() {
    const { input, state, preferences } = this.ports;
    if (input.getKeyBindings) {
      state.keyBindings = input.getKeyBindings();
      preferences.write('keyBindings', JSON.stringify(state.keyBindings));
    }
    this.ports.onBindingsChanged?.();
  }
  releasePointerLock() {
    this.ports.input.exitLock?.();
  }
  toggleMusic() {
    this.setMusic(!this.ports.state.musicWanted);
    return this.ports.state.musicWanted;
  }
  setName(value: string) {
    const { state, preferences, player, transport } = this.ports;
    state.myName = value.trim().slice(0, 14) || state.myName;
    preferences.write('name', state.myName);
    player.name = state.myName;
    transport.hostName = state.myName;
  }
  selectMap(map: MapKey) {
    this.ports.state.mapKey = map;
    this.ports.preferences.write('map', map);
  }
}
