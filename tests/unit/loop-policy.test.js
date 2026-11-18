import { afterEach, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { createLoop } from '../../src/application/frame-composition.js';

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function fixture() {
  vi.useFakeTimers();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const events = [];
  const event = (name) => vi.fn((...args) => events.push([name, ...args]));
  const game = {
    state: 'play',
    mode: 'solo',
    menu: false,
    time: 0,
    hitstopT: 0,
    hitstopScale: 0.2,
    focus: { active: false },
    comboT: 0,
    combo: 2,
    score: 100,
    queue: [],
    intermission: 0,
    katanaStreak: 0,
    boss: null,
    overT: 0,
  };
  const weapon = {
    kind: 'rifle',
    name: 'RIFLE',
    isGun: true,
    mag: 8,
    reserve: 40,
    magSize: 8,
    reloading: false,
    spreadPx: 2,
  };
  const player = {
    body: { pos: new Vector3() },
    eye: new Vector3(),
    right: new Vector3(1, 0, 0),
    weapon,
    weapons: [weapon],
    weaponIndex: 0,
    shieldT: 1,
    hp: 80,
    maxHp: 120,
    alive: true,
    grenades: 2,
    grapStam: 0.7,
    hurtFx: 0,
    flashFx: 0,
    update: event('player'),
    idleCam: event('idleCam'),
  };
  const input = {
    update: event('input'),
    pressed: vi.fn(() => false),
    down: vi.fn(() => false),
    usingGamepad: false,
    pointerLocked: true,
    anyInput: false,
    exitLock: event('exitLock'),
  };
  const hud = {
    el: { board: { hidden: true } },
    setBoard: vi.fn((html) => {
      hud.el.board.hidden = html === null;
    }),
    onScreenClick: event('screenClick'),
    tip: event('tip'),
    setScore: event('score'),
    setNerdStats: vi.fn(),
    setBoss: event('boss'),
    setAmmo: vi.fn(),
    setKatana: vi.fn(),
    setSlots: vi.fn(),
    setGrenades: vi.fn(),
    setGrappleStamina: vi.fn(),
    setHealth: vi.fn(),
    setSpread: vi.fn(),
    setFocusMeter: vi.fn(),
    update: event('hud'),
  };
  const state = {
    musicWanted: false,
    level: {
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
      animated: [{ update: event('animation') }],
    },
  };
  const runtime = {
    game,
    player,
    input,
    hud,
    state,
    userSettings: { toggleMusic: vi.fn(() => true) },
    statsEnabled: false,
    statsPing: { value: 42, label: 'HOST' },
    net: { active: false, isHost: false, send: event('send') },
    online: () => game.mode === 'ffa',
    enemies: { alive: 0, update: event('enemies') },
    effects: { update: event('effects') },
    remote: new Map(),
    audio: {
      ctx: null,
      musicPlaying: true,
      musicOn: event('music'),
      resume: event('resumeAudio'),
      setListener: event('listener'),
      setIntensity: event('intensity'),
    },
    R: { render: event('render') },
  };
  const actions = {
    resume: event('resume'),
    pause: event('pause'),
    boardHTML: () => 'board',
    updateFocus: event('focus'),
    endFocus: event('endFocus'),
    updatePickups: event('pickups'),
    netUpdate: event('network'),
    updateWaves: event('waves'),
    updateArenaPickups: event('arenaPickups'),
    updateDeath: event('death'),
    toLobbyScreen: event('lobby'),
  };
  const loop = createLoop(
    {
      game,
      player,
      input,
      hud,
      audio: runtime.audio,
      renderer: runtime.R,
      enemies: runtime.enemies,
      effects: runtime.effects,
      net: runtime.net,
      online: runtime.online,
      level: () => state.level,
      musicWanted: () => state.musicWanted,
      audioReady: () => !!runtime.audio.ctx,
      remoteCount: () => runtime.remote.size,
      clearBoss: () => {
        game.boss = null;
      },
      toggleMusic: () => runtime.userSettings.toggleMusic(),
      boardVisible: () => !hud.el.board.hidden,
      screenClick: () => hud.onScreenClick(),
      settingsOpen: () => false,
      stats: {
        enabled: () => runtime.statsEnabled,
        ping: () => runtime.statsPing,
      },
    },
    actions,
  );
  return { runtime, game, player, input, hud, actions, events, loop, start: performance.now() };
}
it('caps time at 50 ms and preserves simulation, network and presentation phase order', () => {
  const f = fixture();
  f.loop.step(f.start + 1000);
  expect(f.game.time).toBe(0.05);
  expect(f.player.shieldT).toBe(0.95);
  expect(f.events.map(([name]) => name)).toEqual([
    'input',
    'focus',
    'player',
    'enemies',
    'effects',
    'pickups',
    'network',
    'waves',
    'death',
    'animation',
    'listener',
    'hud',
    'intensity',
    'render',
  ]);
  expect(f.actions.updateDeath).toHaveBeenCalledWith('play', 0.05);
});
it('measures rendered animation frames and resets after a background-tab pause', () => {
  const f = fixture();
  f.runtime.statsEnabled = true;
  f.loop.start();
  for (let frame = 1; frame <= 61; frame++) f.loop.tick(f.start + (frame * 1000) / 60);
  expect(f.hud.setNerdStats).toHaveBeenCalled();
  expect(f.hud.setNerdStats.mock.lastCall[0]).toBeCloseTo(60);
  expect(f.hud.setNerdStats.mock.lastCall.slice(1)).toEqual([42, 'HOST']);
  f.loop.tick(f.start + 5000);
  expect(f.hud.setNerdStats).toHaveBeenLastCalledWith(null, 42, 'HOST');
  f.runtime.statsEnabled = false;
  f.loop.stop();
});
it('includes frames rendered by the online background scheduler in FPS', () => {
  const f = fixture();
  f.runtime.net.active = true;
  f.runtime.statsEnabled = true;
  f.loop.start();
  f.loop.tick(f.start);
  vi.advanceTimersByTime(1000);

  expect(f.runtime.R.render).toHaveBeenCalledTimes(3);
  expect(f.hud.setNerdStats).toHaveBeenLastCalledWith(2, 42, 'HOST');
  f.loop.stop();
});
it('samples nerd stats only while enabled during play or dying phases', () => {
  const f = fixture();
  f.runtime.statsEnabled = true;
  f.loop.start();
  f.game.state = 'pause';
  f.loop.tick(f.start + 500);
  expect(f.hud.setNerdStats).not.toHaveBeenCalled();

  f.runtime.statsEnabled = false;
  f.game.state = 'play';
  f.loop.tick(f.start + 516);
  expect(f.hud.setNerdStats).not.toHaveBeenCalled();

  f.runtime.statsEnabled = true;
  f.game.state = 'dying';
  f.loop.tick(f.start + 532);
  for (let frame = 1; frame <= 61; frame++) f.loop.tick(f.start + 532 + (frame * 1000) / 60);
  expect(f.hud.setNerdStats).toHaveBeenCalled();
  f.game.state = 'dead';
  const calls = f.hud.setNerdStats.mock.calls.length;
  f.loop.tick(f.start + 1600);
  expect(f.hud.setNerdStats).toHaveBeenCalledTimes(calls);
  f.loop.stop();
});
it('uses the captured phase for a pause transition and scales simulation independently of real time', () => {
  const f = fixture();
  f.game.hitstopT = 0.01;
  f.game.focus.active = true;
  f.input.pressed.mockImplementation((action) => action === 'pause');
  f.actions.pause.mockImplementation(() => {
    f.game.state = 'pause';
    f.game.menu = true;
  });
  f.loop.step(f.start + 50);
  expect(f.game.state).toBe('pause');
  expect(f.game.hitstopT).toBeCloseTo(-0.04);
  expect(f.player.update.mock.lastCall[0]).toBeCloseTo(0.01);
  expect(f.actions.netUpdate).toHaveBeenCalledWith(0.05, 0.05);
  expect(f.actions.updateDeath).toHaveBeenCalledWith('play', 0.05);
  f.player.update.mockClear();
  f.input.pressed.mockReturnValue(false);
  f.loop.step(f.start + 66);
  expect(f.player.update).not.toHaveBeenCalled();
});
it('keeps online death/menu simulation live and sends arena/network updates in real time', () => {
  const f = fixture();
  f.game.state = 'dying';
  f.game.mode = 'ffa';
  f.game.menu = true;
  f.loop.step(f.start + 50);
  expect(f.player.update).toHaveBeenCalledWith(0.05);
  expect(f.actions.endFocus).toHaveBeenCalledOnce();
  expect(f.actions.updateArenaPickups).toHaveBeenCalledWith(0.05);
  expect(f.actions.updateWaves).not.toHaveBeenCalled();
  expect(f.actions.updateDeath).toHaveBeenCalledWith('dying', 0.05);
});
it('preserves mouse hold versus controller toggle for the scoreboard and hides it under the menu', () => {
  const f = fixture();
  f.game.mode = 'ffa';
  f.input.down.mockImplementation((action) => action === 'score');
  f.loop.step(f.start + 50);
  expect(f.hud.setBoard).toHaveBeenLastCalledWith('board');
  f.game.menu = true;
  f.loop.step(f.start + 100);
  expect(f.hud.setBoard).toHaveBeenLastCalledWith(null);
  f.game.menu = false;
  f.input.usingGamepad = true;
  f.input.pressed.mockImplementation((action) => action === 'score');
  f.loop.step(f.start + 150);
  expect(f.hud.setBoard).toHaveBeenLastCalledWith('board');
  f.input.pressed.mockReturnValue(false);
  f.loop.step(f.start + 200);
  expect(f.hud.el.board.hidden).toBe(false);
  f.input.pressed.mockImplementation((action) => action === 'score');
  f.loop.step(f.start + 250);
  expect(f.hud.el.board.hidden).toBe(true);
});
it.each([
  [true, 8],
  [false, 15],
])('returns results to the lobby strictly after the existing host=%s delay', (host, delay) => {
  const f = fixture();
  f.game.state = 'over';
  f.game.mode = 'ffa';
  f.game.overT = delay;
  f.runtime.net.isHost = host;
  f.loop.step(f.start);
  expect(f.actions.toLobbyScreen).not.toHaveBeenCalled();
  f.loop.step(f.start + 10);
  expect(f.actions.toLobbyScreen).toHaveBeenCalledOnce();
  if (host) expect(f.runtime.net.send).toHaveBeenCalledWith('backtolobby', {});
  else expect(f.runtime.net.send).not.toHaveBeenCalled();
});
it('uses background steps without creating another animation chain and stops its schedulers', () => {
  const f = fixture();
  f.runtime.net.active = true;
  f.loop.start();
  f.loop.start();
  expect(requestAnimationFrame).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1000);
  expect(f.player.update).toHaveBeenCalledTimes(2);
  expect(requestAnimationFrame).toHaveBeenCalledOnce();
  f.loop.stop();
  const count = f.player.update.mock.calls.length;
  vi.advanceTimersByTime(1000);
  f.loop.tick(performance.now());
  expect(f.player.update).toHaveBeenCalledTimes(count);
  expect(vi.getTimerCount()).toBe(0);
});
