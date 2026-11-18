// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { applicationFixture } from '../support/application.js';

let fixture;
afterEach(() => {
  fixture?.app.dispose();
  fixture = null;
  vi.clearAllTimers();
  vi.useRealTimers();
});
it('applies persisted look settings to mouse and both controller axes through the controls panel', () => {
  fixture = applicationFixture();
  const { input, state, values } = fixture;
  expect(input.mouseSens).toBeCloseTo(0.0022);
  const sensitivity = document.querySelector('#setSens');
  sensitivity.value = '250';
  sensitivity.dispatchEvent(new Event('input'));
  expect(state.settings.sens).toBe(250);
  expect(input.mouseSens).toBeCloseTo(0.0055);
  expect(input.padSensX).toBeCloseTo(8.5);
  expect(input.padSensY).toBeCloseTo(6.5);
  expect(document.querySelector('#setSensV').textContent).toBe('250%');
  expect(values.get('paper_sens')).toBe('250');
  const invert = document.querySelector('#setInv');
  invert.checked = true;
  invert.dispatchEvent(new Event('change'));
  expect(input.invertY).toBe(true);
  expect(state.settings.invert).toBe(true);
  expect(values.get('paper_invert')).toBe('1');
  sensitivity.value = '25';
  sensitivity.dispatchEvent(new Event('input'));
  expect(input.mouseSens).toBeCloseTo(0.00055);
});
it('keeps checkbox, keyboard music commands, persistence and newly rendered panels consistent', () => {
  vi.useFakeTimers();
  fixture = applicationFixture();
  const { audio, app, input, state, values, frame, game } = fixture;
  const music = vi.spyOn(audio, 'musicOn');
  const checkbox = document.querySelector('#setMus');
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change'));
  expect(state.musicWanted).toBe(true);
  expect(values.get('paper_music')).toBe('1');
  expect(music).toHaveBeenLastCalledWith(true);
  input.keys.music = true;
  frame(0.05);
  expect(state.musicWanted).toBe(false);
  expect(values.get('paper_music')).toBe('0');
  expect(music).toHaveBeenLastCalledWith(false);
  input.keys.music = false;
  frame(0.05);
  input.keys.music = true;
  frame(0.05);
  expect(state.musicWanted).toBe(true);
  game.state = 'play';
  app.session.pause();
  expect(document.querySelector('#setMus').checked).toBe(true);
});
it('normalizes name edits, retains the previous name on blank input and synchronizes both actor identities', () => {
  fixture = applicationFixture();
  const { net, state, player, values } = fixture;
  vi.spyOn(net, 'listLobbies').mockResolvedValue([]);
  document.querySelector('#onlineBtn').click();
  const name = document.querySelector('#setName');
  name.value = '   abcdefghijklmnopqrstuvwxyz   ';
  name.dispatchEvent(new Event('input'));
  expect(state.myName).toBe('abcdefghijklmn');
  expect(values.get('paper_name')).toBe(state.myName);
  expect(player.name).toBe(state.myName);
  expect(net.hostName).toBe(state.myName);
  name.value = '   ';
  name.dispatchEvent(new Event('input'));
  expect(state.myName).toBe('abcdefghijklmn');
  expect(values.get('paper_name')).toBe(state.myName);
  expect(player.name).toBe(state.myName);
  expect(net.hostName).toBe(state.myName);
});
it('persists and applies appearance and nerd stats without rebuilding the renderer', () => {
  fixture = applicationFixture();
  const { app, renderer, state, values } = fixture;
  const appearance = document.querySelector('#setAppearance');
  appearance.value = 'dark';
  appearance.dispatchEvent(new Event('change'));
  expect(state.appearance).toBe('dark');
  expect(values.get('paper_appearance')).toBe('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(renderer.setDarkMode).toHaveBeenCalledWith(true);
  const nerdStats = document.querySelector('#setNerdStats');
  nerdStats.checked = true;
  nerdStats.dispatchEvent(new Event('change'));
  expect(state.nerdStats).toBe(true);
  expect(values.get('paper_nerdStats')).toBe('1');
  expect(app.runtime.net.nerdStatsEnabled).toBe(true);
  expect(document.querySelector('#nerdStats').hidden).toBe(false);
  appearance.value = 'light';
  appearance.dispatchEvent(new Event('change'));
  nerdStats.checked = false;
  nerdStats.dispatchEvent(new Event('change'));
  expect(renderer.setDarkMode).toHaveBeenLastCalledWith(false);
  expect(app.runtime.net.nerdStatsEnabled).toBe(false);
  expect(document.querySelector('#nerdStats').hidden).toBe(true);
});
it('clears and restores configurable bindings through the persisted settings model', () => {
  fixture = applicationFixture();
  const { state, values } = fixture;
  document.querySelector('[data-action="jump"][data-device="key"][data-clear]').click();
  expect(state.keyBindings.jump.keys).toEqual([]);
  expect(JSON.parse(values.get('paper_keyBindings')).jump.keys).toEqual([]);
  expect(document.querySelector('.dynamic-controls').textContent).toContain('unassigned');
  document.querySelector('#resetBindings').click();
  expect(state.keyBindings.jump.keys).toEqual(['Space']);
  expect(JSON.parse(values.get('paper_keyBindings')).jump.keys).toEqual(['Space']);
});
it('keeps an existing binding when the requested key is already assigned', () => {
  fixture = applicationFixture();
  const { input, state, values } = fixture;
  document.querySelector('[data-action="jump"][data-capture="key"]').click();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
  expect(state.keyBindings.jump.keys).toEqual(['Space']);
  expect(input.keyLabel('jump')).toBe('Space');
  expect(values.has('paper_keyBindings')).toBe(false);
  expect(document.querySelector('#bindingStatus').textContent).toContain('already assigned');
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
});
it('shows multiplayer ping values but keeps offline stats clearly unavailable', () => {
  fixture = applicationFixture();
  const { app, game, net } = fixture;
  net.getNerdPing = null;
  app.runtime.userSettings.setNerdStats(true);
  game.state = 'play';
  app.loop.start();
  // Use integer timestamps so the next sample lands exactly on the 1,000 ms boundary.
  const start = Math.ceil(performance.now());
  app.loop.tick(start + 16);
  expect(document.querySelector('.hud-tl #nerdStats')).not.toBeNull();
  expect(document.querySelector('#nerdStats').textContent).toContain('PING N/A -- ms');

  game.mode = 'ffa';
  net.getNerdPing = vi.fn(() => ({ value: 17.4, label: 'HOST' }));
  app.loop.tick(start + 1016);
  expect(net.getNerdPing).toHaveBeenCalled();
  expect(document.querySelector('#nerdStats').textContent).toContain('PING HOST 17.4 ms');
});

it('can restore standalone Ctrl and Alt bindings while reserving browser shortcuts', () => {
  fixture = applicationFixture();
  const { state, values } = fixture;
  const startCapture = (action) =>
    document.querySelector(`[data-action="${action}"][data-capture="key"]`).click();
  const press = (code, modifiers = {}) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code, cancelable: true, ...modifiers }));

  startCapture('crouch');
  press('KeyZ');
  expect(state.keyBindings.crouch.keys).toEqual(['KeyZ']);
  startCapture('crouch');
  press('KeyR', { ctrlKey: true });
  expect(document.querySelector('#bindingStatus').textContent).toContain('reserved');
  expect(state.keyBindings.crouch.keys).toEqual(['KeyZ']);
  press('ControlLeft', { ctrlKey: true });
  expect(state.keyBindings.crouch.keys).toEqual(['ControlLeft']);

  startCapture('dash');
  press('KeyT');
  startCapture('dash');
  press('AltLeft', { altKey: true });
  expect(JSON.parse(values.get('paper_keyBindings')).dash.keys).toEqual(['AltLeft']);
});
it('captures and persists a key binding outside pointer lock and refreshes the guide', () => {
  fixture = applicationFixture();
  const { input, state, values } = fixture;
  document.querySelector('[data-action="jump"][data-capture="key"]').click();
  expect(input.pointerLocked).toBe(false);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', bubbles: true }));
  expect(input.keyLabel('jump')).toBe('J');
  expect(state.keyBindings.jump.keys[0]).toBe('KeyJ');
  expect(JSON.parse(values.get('paper_keyBindings')).jump.keys[0]).toBe('KeyJ');
  expect(document.querySelector('.dynamic-controls').textContent).toContain('J');
  document.querySelector('[data-action="sprint"][data-capture="key"]').click();
  window.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }),
  );
  expect(document.querySelector('#bindingStatus').textContent).toContain('cancelled');
});

it('refreshes the weapon shortcut badge after a remap with the same weapon and ammo', () => {
  fixture = applicationFixture();
  const { app, frame, player } = fixture;
  const shortcut = () => document.querySelector('#slots .num').textContent;
  const press = (code, key) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key, cancelable: true }));
    frame();
    window.dispatchEvent(new KeyboardEvent('keyup', { code, key }));
  };

  app.session.begin();
  frame();
  expect(shortcut()).toBe('1');
  app.session.pause();
  document.querySelector('[data-action="slot1"][data-capture="key"]').click();
  press('KeyZ', 'z');
  expect(shortcut()).toBe('Z');
  app.session.resume();

  press('Digit2', '2');
  expect(player.weaponIndex).toBe(1);
  press('Digit1', '1');
  expect(player.weaponIndex).toBe(1);
  press('KeyZ', 'z');
  expect(player.weaponIndex).toBe(0);
});

it('keeps controller confirmation from starting or resuming with the settings dialog open', () => {
  fixture = applicationFixture();
  const { app, frame, game, input } = fixture;
  const pad = { axes: [], buttons: [{ pressed: true, value: 1 }] };
  vi.spyOn(input, '_getPad').mockReturnValue(pad);

  const dialog = document.querySelector('#settingsShell');
  dialog.open = true;
  frame();
  expect(game.state).toBe('start');
  dialog.open = false;
  app.session.begin();
  app.session.pause();

  const pausedDialog = document.querySelector('#settingsShell');
  pausedDialog.open = true;
  pad.buttons[0].pressed = false;
  pad.buttons[0].value = 0;
  frame();
  pad.buttons[0].pressed = true;
  frame();
  expect(game.state).toBe('pause');
  pausedDialog.open = false;
  pad.buttons[0].pressed = false;
  frame();
  pad.buttons[0].pressed = true;
  frame();
  expect(game.state).toBe('play');
});

it('releases a pending binding capture when match results replace the pause screen', () => {
  fixture = applicationFixture();
  const { app, game, hud, values } = fixture;
  game.mode = 'ffa';
  game.state = 'play';
  app.screens.showPause();
  document.querySelector('[data-action="jump"][data-capture="key"]').click();

  hud.showScreen('<h1>MATCH RESULTS</h1>');
  const key = new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', cancelable: true });
  window.dispatchEvent(key);
  expect(key.defaultPrevented).toBe(false);
  expect(values.has('paper_keyBindings')).toBe(false);
});
