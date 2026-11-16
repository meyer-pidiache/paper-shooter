// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { SettingsPanel } from '../../src/presentation/settings-panel.js';
import { cloneKeyBindings } from '../../src/shared/key-bindings.js';

const commands = () => ({
  setSensitivity: vi.fn(),
  setInvert: vi.fn(),
  setMusic: vi.fn(),
  setName: vi.fn(),
  setAppearance: vi.fn(),
  setNerdStats: vi.fn(),
  getKeyBindings: () => cloneKeyBindings(),
  keyLabel: (action: string) => action,
  setBinding: vi.fn(() => null),
  clearBinding: vi.fn(),
  resetKeyBindings: vi.fn(),
  releasePointerLock: vi.fn(),
});
const view = () => ({
  settings: { sens: 100, invert: false },
  musicWanted: false,
  appearance: 'light' as const,
  nerdStats: false,
  keyBindings: cloneKeyBindings(),
});
it('keeps settings clicks and key presses from reaching menu controls', () => {
  const panel = document.createElement('div');
  const adapter = new SettingsPanel(view(), commands());
  panel.innerHTML = adapter.html();
  adapter.wire(panel);
  const clicked = vi.fn(),
    keyed = vi.fn();
  panel.addEventListener('click', clicked);
  panel.addEventListener('keydown', keyed);
  const input = panel.querySelector('#setSens');
  input?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(clicked).not.toHaveBeenCalled();
  expect(keyed).not.toHaveBeenCalled();
});
it('can bind screens without settings or a name input', () => {
  const panel = document.createElement('div');
  const actions = commands();
  const adapter = new SettingsPanel(view(), actions);
  expect(() => {
    adapter.wire(panel);
    adapter.wireName(panel);
  }).not.toThrow();
  expect(actions.setSensitivity).not.toHaveBeenCalled();
  expect(actions.setName).not.toHaveBeenCalled();
});
