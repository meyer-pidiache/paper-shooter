import { expect, it, vi } from 'vitest';
import { UserSettings } from '../../src/application/user-settings.js';
import { cloneKeyBindings } from '../../src/shared/key-bindings.js';

it('keeps settings usable when optional browser input adapters are unavailable', () => {
  const state = {
    settings: { sens: 100, invert: false },
    musicWanted: false,
    myName: 'paper',
    playerColor: 'original' as const,
    mapKey: 'district' as const,
    appearance: 'light' as const,
    nerdStats: false,
    keyBindings: cloneKeyBindings(),
  };
  const write = vi.fn();
  const settings = new UserSettings({
    state,
    preferences: { write },
    input: { mouseSens: 0, padSensX: 0, padSensY: 0, invertY: false },
    audio: { musicOn: vi.fn() },
    player: { name: 'paper' },
    transport: { hostName: 'paper' },
  });

  expect(() => settings.applyInitial()).not.toThrow();
  expect(settings.getKeyBindings()).toBe(state.keyBindings);
  expect(settings.keyLabel('jump')).toBe('jump');
  expect(settings.setBinding('jump', 'key', 'KeyJ')).toBeNull();
  settings.clearBinding('jump', 'key');
  settings.resetKeyBindings();
  settings.releasePointerLock();
  expect(write).toHaveBeenCalledWith('sens', 100);
  expect(write).toHaveBeenCalledWith('invert', '0');
  expect(write).not.toHaveBeenCalledWith('keyBindings', expect.any(String));
});
