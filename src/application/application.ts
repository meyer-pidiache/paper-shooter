import type { ApplicationOptions } from './contracts.js';
import type { ApplicationDebug, DebugCommands } from './application-debug.js';
import { SessionController } from './session-controller.js';
import { RunReset } from './run-reset.js';
import { createRuntime } from './runtime.js';
import { PickupController } from './pickups.js';
import { FocusController } from './focus.js';
import { FocusMarker } from '../presentation/focus-marker.js';
import { SettingsPanel } from '../presentation/settings-panel.js';
import { WaveController } from './waves.js';
import { EnemyRewards } from './enemy-rewards.js';
import { MatchController } from './match.js';
import { INK } from '../shared/ink.js';
import { presentPickup } from '../presentation/pickups.js';
import { ScreenController } from './screens.js';
import { BrowserScreens } from '../presentation/screen-bindings.js';
import { createMultiplayer } from './multiplayer.js';
import { createControls } from './controls.js';
import { createLoop } from './frame-composition.js';

// Callbacks connect controllers explicitly; factories register callbacks but do not start the loop.
export function createApplication(options: ApplicationOptions) {
  const runtime = createRuntime(options, {
    spawnPickup: (...args) => pickups.spawnPickup(...args),
  });
  const audio = runtime.audio;
  const debug: ApplicationDebug = {
    ...runtime,
    get level() {
      return runtime.state.level;
    },
    get nav() {
      return runtime.state.nav;
    },
    inspect() {
      return {
        state: runtime.game.state,
        mode: runtime.game.mode,
        map: runtime.state.level.key,
        wave: runtime.game.wave,
        hp: runtime.player.hp,
        alive: runtime.enemies.alive,
        weapon: runtime.player.weapon.kind,
      };
    },
  };
  window.__game = debug;
  const pickupFeedback = { hud: runtime.hud, audio, effects: runtime.effects };
  const pickups = new PickupController({
    state: runtime.state,
    scene: runtime.R.scene,
    resources: runtime.resources,
    player: runtime.player,
    transport: runtime.net,
    map: () => runtime.state.level.key,
    spawnPoints: () => runtime.state.level.pickups,
    collected: (kind, point) => presentPickup(pickupFeedback, kind, runtime.state.level.key, point),
  });
  const combat = runtime.combat;
  const focusMarker = new FocusMarker({
    camera: runtime.R.camera,
    viewport: window,
    hud: runtime.hud,
  });
  const focus = new FocusController({
    state: runtime.game.focus,
    player: runtime.player,
    targets: () => runtime.enemies.enemies,
    damage: (...args) => runtime.enemies.damage(...args),
    world: runtime.world,
    online: runtime.online,
    slash: () => runtime.player.slashKatana(),
    resetCharge: () => {
      runtime.game.katanaStreak = 0;
    },
    hitstop: (duration, scale) => runtime.game.hitstop(duration, scale),
    marker: (point) => focusMarker.show(point),
    audio,
    hud: runtime.hud,
    input: runtime.input,
    effects: runtime.effects,
  });
  const waves = new WaveController({
    state: runtime.game,
    level: () => runtime.state.level,
    checkpoint: () => runtime.progress.checkpoint,
    saveCheckpoint: (wave) => runtime.progress.saveCheckpoint(wave),
    player: runtime.player,
    enemies: runtime.enemies,
    world: runtime.world,
    hud: runtime.hud,
    audio,
    spawnPickup: (...args) => pickups.spawnPickup(...args),
    score: (points, label) => runtime.game.addScore(points, label),
  });
  const rewards = new EnemyRewards({
    state: runtime.game,
    grounded: () => runtime.player.body.onGround,
    bladeBlood: (amount) => {
      const blade = runtime.player.weapons[runtime.player.katanaIndex];
      if (blade.kind === 'katana') blade.addBlood(amount);
    },
    enterFocus: () => focus.enterFocus(),
    score: (points, label) => runtime.game.addScore(points, label),
    killSound: (strong) => audio.kill(strong),
    spawnPickup: (...args) => pickups.spawnPickup(...args),
  });
  runtime.enemies.onKill = (enemy, impact, severed) => rewards.grant(enemy, impact, severed);
  runtime.enemies.onBoss = (enemy) => {
    if (!enemy.alive) {
      runtime.hud.setBoss(null, null);
      runtime.game.boss = null;
    } else {
      runtime.game.boss = enemy;
      runtime.hud.setBoss(enemy.T.name, enemy.hp / enemy.maxHp);
    }
  };
  runtime.player.onThrow = (data) => {
    if (runtime.net.active) runtime.net.broadcast('nade', data);
  };
  const match = new MatchController({
    player: runtime.player,
    opponents: () => runtime.remote.values(),
    level: () => runtime.state.level,
    online: runtime.online,
    finished: () => runtime.game.over !== null,
    localName: () => runtime.state.myName,
    remainingTime: () => runtime.state.matchLeft,
    lobbyCode: () => String(runtime.net.aliasCode || runtime.net.code || ''),
    boardVisible: () => !runtime.hud.el.board.hidden,
    transport: runtime.net,
    scores: runtime.scores,
    hud: runtime.hud,
    spawnFeedback: (point) => {
      runtime.effects.strokeBurst(point, INK.BLUE, 24, 6, { life: 0.5, size: 0.03 });
      audio.spawn(point);
    },
    exitLock: () => runtime.input.exitLock(),
    endFocus: () => focus.endFocus(),
    session: {
      playerDied: () => session.playerDied(),
      playerRespawned: () => session.playerRespawned(),
      finishMatch: (winner) => session.finishMatch(winner),
      returnFromResults: () => session.returnFromResults(),
    },
  });
  const reset = new RunReset({
    state: runtime.state,
    game: runtime.game,
    player: runtime.player,
    resources: runtime.resources,
    enemies: runtime.enemies,
    effects: runtime.effects,
    hud: runtime.hud,
    online: runtime.online,
    setLevel: runtime.setLevel,
    endFocus: () => focus.endFocus(),
  });
  const session = new SessionController({
    game: runtime.game,
    screen: runtime.state,
    input: runtime.input,
    audio,
    hud: runtime.hud,
    presentation: {
      start: () => screens.showStart(),
      pause: () => screens.showPause(),
      clickToPlay: () => screens.showClickToPlay(),
      dead: () => screens.showDead(),
    },
    transport: runtime.net,
    lobby: runtime.lobby,
    scores: runtime.scores,
    player: runtime.player,
    remote: () => runtime.remote.values(),
    setArena: runtime.setArena,
    resetRun: () => reset.reset(),
    clearWave: () => reset.clearWave(),
    startWave: (wave) => waves.startWave(wave),
    spawnSpots: () => match.spawnSpots(),
    arenaSpawn: () => match.arenaSpawn(),
    sendScores: () => match.sendScores(),
    prepareRejoins: () => multiplayer.beginMatch(),
    clearRejoins: () => multiplayer.clearRejoins(),
    refreshScores: () => match.refreshScoreHud(),
    respawnLocal: () => match.respawnLocal(),
  });
  const settingsPanel = new SettingsPanel(runtime.state, runtime.userSettings);
  runtime.hud.onScreenChange = () => settingsPanel.close();
  const screens = new ScreenController({
    navigation: runtime.state,
    profile: runtime.state,
    game: runtime.game,
    lobby: runtime.lobby,
    transport: runtime.net,
    records: runtime.progress,
    view: new BrowserScreens(runtime.hud, settingsPanel),
    online: runtime.online,
    selectMap: (map) => runtime.userSettings.selectMap(map),
    actions: {
      cancelPending: () => multiplayer.cancelPending(),
      lobbyRows: (...args) => multiplayer.lobbyRows(...args),
      friendlyError: (...args) => multiplayer.friendlyError(...args),
      quickPlay: (...args) => multiplayer.quickPlay(...args),
      createLobby: (...args) => multiplayer.createLobby(...args),
      setStatus: (...args) => multiplayer.setStatus(...args),
      joinLobby: (...args) => multiplayer.joinLobby(...args),
      broadcastLobby: (...args) => multiplayer.broadcastLobby(...args),
      hostStart: (...args) => session.hostStart(...args),
      leaveOnline: (...args) => multiplayer.leaveOnline(...args),
      beginAtWave: (...args) => session.beginAtWave(...args),
      begin: (...args) => session.begin(...args),
      sortedScores: (...args) => match.sortedScores(...args),
      toMainMenu: () => session.toMainMenu(),
    },
  });
  const multiplayer = createMultiplayer(
    {
      remote: runtime.remote,
      remoteServices: runtime.remoteServices,
      net: runtime.net,
      lobby: runtime.lobby,
      scores: runtime.scores,
      local: runtime.state,
      game: runtime.game,
      player: runtime.player,
      input: runtime.input,
      effects: runtime.effects,
      audio,
      hud: runtime.hud,
      shotQueue: runtime.shotQueue,
      inMatch: runtime.inMatch,
      online: runtime.online,
      canHurt: (target) => runtime.combat.canHurt(target),
    },
    {
      renderLobby: (...args) => screens.renderLobby(...args),
      sendScores: (...args) => match.sendScores(...args),
      refreshScoreHud: (...args) => match.refreshScoreHud(...args),
      farthestSpawnIndex: (...args) => match.farthestSpawnIndex(...args),
      startMatch: (...args) => session.startMatch(...args),
      breakProp: (...args) => combat.breakProp(...args),
      hostStart: (...args) => session.hostStart(...args),
      endMatch: (...args) => match.endMatch(...args),
      requestLobbyReturn: () => session.requestLobbyReturn(),
      spawnPickup: (...args) => pickups.spawnPickup(...args),
      removePickup: (...args) => pickups.removePickup(...args),
      tallyDeath: (...args) => match.tallyDeath(...args),
      applyScores: (...args) => match.applyScores(...args),
      sortedScores: (...args) => match.sortedScores(...args),
      session: {
        enterLobby: () => session.enterLobby(),
        returnOnline: () => session.returnOnline(),
        takeClockAuthority: () => session.takeClockAuthority(),
        recoverHost: (wasInMatch) => session.recoverHost(wasInMatch),
        recoverFollower: (wasInMatch) => session.recoverFollower(wasInMatch),
      },
      connectionPresentation: {
        start: () => screens.showStart(),
        status: (message) => screens.showConnectionStatus(message),
        unlockButtons: () => screens.unlockButtons(),
        message: (...args) => runtime.hud.message(...args),
        feed: (message) => runtime.hud.kill(message, 0),
      },
    },
  );
  const controls = createControls(
    {
      canvas: runtime.canvas,
      panel: runtime.hud.el.panel,
      matchInProgress: () => ['play', 'dying', 'pause'].includes(runtime.game.state),
      matchTakingInput: () =>
        !runtime.game.menu && (runtime.game.state === 'play' || runtime.game.state === 'dying'),
      input: runtime.input,
      hud: runtime.hud,
      audio,
      player: runtime.player,
      applySettings: runtime.applySettings,
      leavePage: () => {
        if (runtime.net.active) multiplayer.cancelPending();
      },
    },
    session,
  );
  // Keep the existing development/browser automation API in the composition root.
  const debugCommands: DebugCommands = {
    startWave: (wave) => waves.startWave(wave),
    updateWaves: (dt) => waves.updateWaves(dt),
    begin: () => session.begin(),
    beginAtWave: (wave) => session.beginAtWave(wave),
    jumpToWave: (wave) => session.jumpToWave(wave),
    resetGame: () => session.resetGame(),
    spawnPickup: (...args) => pickups.spawnPickup(...args),
    focusCandidate: () => focus.focusCandidate(),
    enterFocus: (...args) => focus.enterFocus(...args),
    pickSpawn: (...args) => waves.pickSpawn(...args),
    startMatch: (...args) => session.startMatch(...args),
    createLobby: (...args) => multiplayer.createLobby(...args),
    joinLobby: (...args) => multiplayer.joinLobby(...args),
    quickPlay: () => multiplayer.quickPlay(),
    leaveOnline: (...args) => multiplayer.leaveOnline(...args),
    hostStart: () => session.hostStart(),
  };
  Object.assign(debug, debugCommands);
  const loop = createLoop(
    {
      game: runtime.game,
      player: runtime.player,
      input: runtime.input,
      hud: runtime.hud,
      audio,
      renderer: runtime.R,
      enemies: runtime.enemies,
      effects: runtime.effects,
      net: runtime.net,
      online: runtime.online,
      level: () => runtime.state.level,
      musicWanted: () => runtime.state.musicWanted,
      stats: {
        enabled: () => runtime.state.nerdStats,
        ping: () => {
          const ping = runtime.net.getNerdPing?.() ?? { value: null, label: 'N/A' };
          return runtime.online() ? ping : { value: null, label: 'N/A' };
        },
      },
      audioReady: () => !!audio.ctx,
      remoteCount: () => runtime.remote.size,
      clearBoss: () => {
        runtime.game.boss = null;
      },
      toggleMusic: () => runtime.userSettings.toggleMusic(),
      boardVisible: () => !runtime.hud.el.board.hidden,
      screenClick: () => runtime.hud.onScreenClick?.(),
      settingsOpen: () => settingsPanel.open,
    },
    {
      resume: (...args) => session.resume(...args),
      pause: (...args) => session.pause(...args),
      boardHTML: (...args) => match.boardHTML(...args),
      updateFocus: (...args) => focus.updateFocus(...args),
      endFocus: (...args) => focus.endFocus(...args),
      updatePickups: (...args) => pickups.updatePickups(...args),
      netUpdate: (...args) => multiplayer.netUpdate(...args),
      updateWaves: (...args) => waves.updateWaves(...args),
      updateArenaPickups: (...args) => pickups.updateArenaPickups(...args),
      updateDeath: (phase, dt) => session.updateDeath(phase, dt),
      updateTabProtection: controls.updateTabProtection,
      updateResults: (elapsed) =>
        session.updateResults(elapsed, () => multiplayer.leaveOnline('the host left the lobby')),
    },
  );

  runtime.game.onPlayerDeath = () => {
    focus.endFocus();
    match.onLocalDeath();
  };
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    loop.stop();
    screens.dispose();
    settingsPanel.close();
    runtime.hud.onScreenChange = null;
    controls.dispose();
    session.dispose();
    multiplayer.dispose();
    runtime.input.dispose?.();
    runtime.player.dispose();
    pickups.dispose();
    runtime.enemies.clear();
    runtime.effects.dispose();
    for (const remote of runtime.remote.values()) remote.dispose();
    runtime.remote.clear();
    audio.dispose();
    runtime.resources.track(runtime.R.scene);
    runtime.resources.dispose();
    runtime.R.scene.clear();
    runtime.R.dispose?.();
    if (window.__game === debug) delete window.__game;
  }
  screens.showStart();
  if (options.autoStart !== false) loop.start();
  return {
    runtime,
    pickups,
    combat,
    focus,
    waves,
    match,
    screens,
    multiplayer,
    controls,
    session,
    loop,
    dispose,
  };
}
