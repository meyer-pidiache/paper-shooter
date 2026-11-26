// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../../src/presentation/settings-panel.js';
import { cloneKeyBindings } from '../../src/shared/key-bindings.js';
import type { BindingDevice, KeyBindingAction } from '../../src/shared/key-bindings.js';

const commands = () => ({
  setSensitivity: vi.fn(),
  setInvert: vi.fn(),
  setMusic: vi.fn(),
  setName: vi.fn(),
  setPlayerColor: vi.fn(),
  setAppearance: vi.fn(),
  setNerdStats: vi.fn(),
  getKeyBindings: () => cloneKeyBindings(),
  keyLabel: (action: string) => action,
  setBinding: vi.fn<
    (action: KeyBindingAction, device: BindingDevice, value: string | number) => string | null
  >(() => null),
  clearBinding: vi.fn(),
  resetKeyBindings: vi.fn(),
  releasePointerLock: vi.fn(),
});
const view = () => ({
  settings: { sens: 100, invert: false },
  musicWanted: false,
  appearance: 'light' as const,
  playerColor: 'original' as const,
  nerdStats: false,
  keyBindings: cloneKeyBindings(),
});
afterEach(() => document.body.replaceChildren());

function setup() {
  const panel = document.createElement('div');
  document.body.append(panel);
  const actions = commands();
  const adapter = new SettingsPanel(view(), actions);
  panel.innerHTML = adapter.html();
  adapter.wire(panel);
  return { panel, actions, adapter };
}

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

it('routes settings changes and binding clear/reset actions to commands', () => {
  const { panel, actions, adapter } = setup();
  const changed = (selector: string, value: string) => {
    const control = panel.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    if (!control) throw new Error(`Missing control: ${selector}`);
    control.value = value;
    control.dispatchEvent(new Event('change', { bubbles: true }));
  };
  changed('#setAppearance', 'dark');
  changed('#setAppearance', 'light');
  const stats = panel.querySelector<HTMLInputElement>('#setNerdStats')!;
  stats.checked = true;
  stats.dispatchEvent(new Event('change', { bubbles: true }));
  stats.checked = false;
  stats.dispatchEvent(new Event('change', { bubbles: true }));
  expect(actions.setAppearance.mock.calls).toEqual([['dark'], ['light']]);
  expect(actions.setNerdStats.mock.calls).toEqual([[true], [false]]);

  panel
    .querySelector<HTMLButtonElement>('[data-action="jump"][data-device="key"][data-clear]')!
    .click();
  expect(actions.clearBinding).toHaveBeenCalledWith('jump', 'key');
  expect(panel.querySelector<HTMLElement>('#bindingStatus')!.textContent).toContain(
    'key binding cleared',
  );
  panel.querySelector<HTMLButtonElement>('#resetBindings')!.click();
  expect(actions.resetKeyBindings).toHaveBeenCalledOnce();
  expect(panel.querySelector<HTMLElement>('#bindingStatus')!.textContent).toContain('restored');

  const partial = document.createElement('div');
  partial.innerHTML =
    '<div id="settings"><div id="controlBindings"><button data-action="jump" data-device="mouse" data-clear="mouse"></button></div></div>';
  adapter.wire(partial);
  partial.querySelector<HTMLButtonElement>('button')!.click();
  expect(actions.clearBinding).toHaveBeenLastCalledWith('jump', 'mouse');
});

it('rejects reserved, repeated, and conflicting keys, then accepts a valid remap', () => {
  const { panel, actions } = setup();
  const button = panel.querySelector<HTMLButtonElement>(
    '[data-action="jump"][data-capture="key"]',
  )!;
  button.click();
  expect(actions.releasePointerLock).toHaveBeenCalledOnce();

  const dispatchKey = (options: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options });
    window.dispatchEvent(event);
    return event;
  };
  const reserved = dispatchKey({ code: 'F5', key: 'F5' });
  expect(reserved.defaultPrevented).toBe(true);
  expect(panel.querySelector<HTMLElement>('#bindingStatus')!.textContent).toContain('reserved');
  dispatchKey({ code: 'KeyJ', key: 'j', repeat: true });
  expect(actions.setBinding).not.toHaveBeenCalled();

  actions.setBinding.mockReturnValueOnce('forward');
  dispatchKey({ code: 'KeyW', key: 'w' });
  expect(panel.querySelector<HTMLElement>('#bindingStatus')!.textContent).toContain('Move forward');
  dispatchKey({ code: 'KeyJ', key: 'j' });
  expect(actions.setBinding).toHaveBeenLastCalledWith('jump', 'key', 'KeyJ');
  expect(panel.querySelector<HTMLElement>('#bindingStatus')!.textContent).toContain('now uses j');
  expect(button.textContent).toBe('CHANGE KEY');
});

it('captures supported mouse buttons, reports conflicts, and ignores keyboard input', () => {
  const { panel, actions } = setup();
  const button = panel.querySelector<HTMLButtonElement>(
    '[data-action="aim"][data-capture="mouse"]',
  )!;
  button.click();

  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j' }));
  expect(actions.setBinding).not.toHaveBeenCalled();
  const dispatchMouse = (mouseButton: number) =>
    document.dispatchEvent(
      new MouseEvent('mousedown', { button: mouseButton, bubbles: true, cancelable: true }),
    );
  dispatchMouse(5);
  expect(panel.querySelector<HTMLElement>('#bindingStatus')!.textContent).toContain(
    'not supported',
  );

  actions.setBinding.mockReturnValueOnce('fire');
  dispatchMouse(0);
  expect(panel.querySelector<HTMLElement>('#bindingStatus')!.textContent).toContain('Fire / slash');
  dispatchMouse(4);
  expect(actions.setBinding).toHaveBeenLastCalledWith('aim', 'mouse', 4);
  expect(panel.querySelector<HTMLElement>('#bindingStatus')!.textContent).toContain(
    'mouse binding updated',
  );
  expect(button.textContent).toBe('CHANGE MOUSE');
});

it('cancels capture safely after its button has been removed', () => {
  const { panel, adapter } = setup();
  const button = panel.querySelector<HTMLButtonElement>(
    '[data-action="jump"][data-capture="key"]',
  )!;
  button.click();
  button.remove();
  expect(() => adapter.cancelCapture()).not.toThrow();
  expect(() => adapter.cancelCapture()).not.toThrow();
});

it('locks the character ink picker when team colors are fixed', () => {
  const panel = document.createElement('div');
  document.body.append(panel);
  const actions = commands();
  const adapter = new SettingsPanel(
    { ...view(), playerColor: 'blue', characterInkLocked: true },
    actions,
  );
  panel.innerHTML = adapter.html();
  adapter.wire(panel);
  const fieldset = panel.querySelector<HTMLFieldSetElement>('#characterInk')!;
  expect(fieldset.disabled).toBe(true);
  const green = panel.querySelector<HTMLInputElement>(
    'input[name="characterColor"][value="green"]',
  )!;
  green.checked = true;
  green.dispatchEvent(new Event('change', { bubbles: true }));
  expect(actions.setPlayerColor).not.toHaveBeenCalled();
});
