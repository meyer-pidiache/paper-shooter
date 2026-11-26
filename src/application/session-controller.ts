import { FFA_TARGET, FFA_TIME, RESPAWN } from '../domain/match.js';
import type { Winner } from '../domain/match.js';
import type { SessionPorts } from './session-contracts.js';
import { DeathProgress } from './death-progress.js';
import { RematchVoting } from './rematch-voting.js';
import { MAP_VOTE_SECONDS } from '../domain/map-vote.js';
import type { GamePhase } from '../domain/match.js';

const RESULTS_READ_TIME = 5;
const RESULTS_GUEST_TIMEOUT = 25;

/** Owns run/session transitions; input, screens and network request commands through composition. */
export class SessionController {
  private resultsDestination: 'lobby' | 'online' | null = null;
  private resultsInputArmed = false;
  private prompt: ReturnType<typeof setTimeout> | null = null;
  private readonly death: DeathProgress;
  readonly mapVote: RematchVoting;
  constructor(private readonly ports: SessionPorts) {
    this.mapVote = new RematchVoting(ports);
    this.death = new DeathProgress({
      state: ports.game,
      input: ports.input,
      hud: ports.hud,
      respawn: () => ports.respawnLocal(),
      soloReady: () => {
        ports.game.state = 'dead';
        ports.presentation.dead();
        ports.input.exitLock();
      },
    });
  }
  dispose() {
    this.cancelPrompt();
  }
  private cancelPrompt() {
    if (this.prompt !== null) clearTimeout(this.prompt);
    this.prompt = null;
  }
  private beginCommon() {
    this.cancelPrompt();
    const { audio, input, hud, screen, game } = this.ports;
    audio.init();
    audio.resume();
    if (!input.usingGamepad) input.requestLock();
    if (screen.musicWanted && !audio.musicPlaying) audio.musicOn(true);
    hud.hideScreen();
    hud.setGameplayVisible(true);
    game.menu = false;
  }
  resetGame() {
    this.ports.resetRun();
  }
  playerDied() {
    const { game } = this.ports;
    if (game.state === 'over') return;
    if (game.mode === 'ffa') game.respawnT = RESPAWN;
    game.state = 'dying';
    game.deathT = 0;
  }
  playerRespawned() {
    this.ports.game.state = 'play';
  }
  updateDeath(phase: GamePhase, dt: number) {
    this.death.update(phase, dt);
  }
  finishMatch(winner: Winner, voteId?: number) {
    const { game } = this.ports;
    if (game.state === 'over') return;
    this.resultsDestination = null;
    this.resultsInputArmed = false;
    this.mapVote.start(voteId);
    game.over = winner;
    game.overT = 0;
    game.state = 'over';
    this.ports.clearRejoins();
  }
  screenClick() {
    const { game, screen } = this.ports;
    const phase = game.state;
    if (phase === 'over') return;
    if (phase === 'lobby') return;
    if (phase === 'start') {
      if (screen.screen === 'main') this.begin();
      return;
    }
    if ((phase === 'play' || phase === 'dying') && game.menu) {
      this.resume();
      return;
    }
    if (phase === 'pause' || phase === 'dead') this.resume();
  }
  requestLobbyReturn() {
    if (this.ports.game.state === 'over' && this.resultsDestination !== 'online')
      this.resultsDestination = 'lobby';
  }
  returnFromResults() {
    const { game, transport } = this.ports;
    if (game.state !== 'over' || game.overT < RESULTS_READ_TIME || !transport.isHost) return;
    if (!this.mapVote.close()) return;
    transport.send('backtolobby', {});
    this.toLobbyScreen();
  }
  updateResults(elapsed: number, leaveDisconnected: () => void) {
    const { game, transport, input, hud } = this.ports;
    if (game.state !== 'over') return;
    const previous = game.overT;
    game.overT += elapsed;
    this.mapVote.update(previous);
    if (game.overT < RESULTS_READ_TIME) return;
    if (this.resultsDestination === 'online') {
      this.returnOnline();
      return;
    }
    if (transport.isHost) {
      if (this.mapVote.active) {
        this.returnFromResults();
        return;
      }
      hud.enableResultsReturn();
      if (!input.down('jump') && !input.down('confirm')) this.resultsInputArmed = true;
      const controllerReturn =
        input.usingGamepad &&
        this.resultsInputArmed &&
        (input.pressed('jump') || input.pressed('confirm'));
      if (controllerReturn || game.overT >= MAP_VOTE_SECONDS) this.returnFromResults();
    } else if (this.resultsDestination === 'lobby' || game.overT >= RESULTS_GUEST_TIMEOUT) {
      if (transport.active) this.toLobbyScreen();
      else leaveDisconnected();
    }
  }
  canvasClick() {
    const { game, input } = this.ports;
    if (game.state === 'play' && !game.menu && !input.pointerLocked && !input.usingGamepad)
      input.requestLock();
  }
  lockChanged(locked: boolean) {
    const { game, input } = this.ports;
    if (
      !locked &&
      (game.state === 'play' || (game.state === 'dying' && game.mode === 'ffa')) &&
      !game.menu &&
      !input.usingGamepad
    )
      this.pause();
  }
  begin() {
    const { game, setArena, startWave } = this.ports;
    game.mode = 'solo';
    setArena(false);
    this.beginCommon();
    if (game.state === 'start' || game.state === 'dead') {
      this.resetGame();
      startWave(1);
    }
    game.state = 'play';
  }
  beginAtWave(wave: number) {
    const { game, setArena, startWave } = this.ports;
    game.mode = 'solo';
    setArena(false);
    this.beginCommon();
    this.resetGame();
    startWave(wave);
    game.state = 'play';
  }
  jumpToWave(wave: number) {
    const { clearWave, startWave, hud, game, audio } = this.ports;
    clearWave();
    startWave(wave);
    hud.hideScreen();
    hud.setGameplayVisible(true);
    game.state = 'play';
    game.menu = false;
    audio.reelLoop(false);
  }
  hostStart() {
    const { scores, lobby, setArena, spawnSpots, transport, screen, sendScores, game } = this.ports;
    if (!transport.isHost || game.state !== 'lobby') return;
    scores.clear();
    lobby.teamBank = { red: 0, blue: 0 };
    if (lobby.mode === 'teams') this.ports.broadcastLobby();
    for (const [id, player] of lobby.players)
      scores.set(id, {
        name: player.name,
        kills: 0,
        deaths: 0,
        ...(lobby.mode === 'teams' && player.team ? { team: player.team } : {}),
      });
    setArena(true);
    const order = spawnSpots().map((_, index) => index);
    for (let index = order.length - 1; index > 0; index--) {
      const chosen = Math.floor(Math.random() * (index + 1));
      [order[index], order[chosen]] = [order[chosen], order[index]];
    }
    const spawns: Record<string, number> = {};
    [...lobby.players.keys()].forEach((id, index) => {
      spawns[id] = order[index % order.length];
    });
    this.ports.prepareRejoins();
    transport.send('start', {
      spawns,
      map: lobby.map || screen.mapKey,
      duration: lobby.duration ?? FFA_TIME,
    });
    this.startMatch(false, transport.id === null ? undefined : spawns[transport.id]);
    sendScores();
  }
  startMatch(late: boolean, spawnIndex?: number) {
    this.mapVote.clear();
    const {
      transport,
      game,
      setArena,
      screen,
      remote,
      scores,
      lobby,
      spawnSpots,
      player,
      arenaSpawn,
      refreshScores,
      hud,
    } = this.ports;
    transport.inMatch = true;
    if (!late) lobby.teamBank = { red: 0, blue: 0 };
    game.mode = 'ffa';
    setArena(true);
    this.resetGame();
    const duration = lobby.duration ?? FFA_TIME;
    screen.matchLeft = duration;
    screen.clockRunning = false;
    screen.clockT = 0;
    game.clockStarted = false;
    for (const actor of remote()) actor.lastSeen = performance.now();
    if (!scores.size)
      for (const [id, member] of lobby.players)
        scores.set(id, {
          name: member.name,
          kills: 0,
          deaths: 0,
          ...(lobby.mode === 'teams' && member.team ? { team: member.team } : {}),
        });
    const spots = spawnSpots();
    player.reset(
      spawnIndex != null && spots[spawnIndex] ? spots[spawnIndex].clone() : arenaSpawn(),
    );
    this.beginCommon();
    game.state = 'play';
    screen.screen = 'lobby';
    player.shieldT = 2;
    refreshScores();
    hud.message(
      lobby.mode === 'teams' ? 'TEAM MATCH' : 'FREE FOR ALL',
      late
        ? 'you joined a match in progress'
        : 'first to ' +
            FFA_TARGET +
            ' · ' +
            duration / 60 +
            ' minutes · ' +
            (lobby.mode === 'teams' ? 'team kills count together' : 'everyone is fair game'),
      3,
    );
    this.prompt = setTimeout(() => {
      this.prompt = null;
      const { input, presentation } = this.ports;
      if (game.state === 'play' && !input.pointerLocked && !input.usingGamepad) {
        game.menu = true;
        presentation.clickToPlay();
      }
    }, 250);
  }
  pause() {
    const { game, presentation, audio } = this.ports;
    const online = game.mode === 'ffa';
    if ((game.state !== 'play' && !(game.state === 'dying' && online)) || game.menu) return;
    if (!online) game.state = 'pause';
    game.menu = true;
    presentation.pause();
    audio.reelLoop(false);
  }
  resume() {
    const { game, input, hud } = this.ports;
    if (game.mode === 'ffa') {
      game.menu = false;
      if (game.state === 'dying' && game.respawnT <= 0) game.respawnArm = input.lastActive;
      hud.hideScreen();
      hud.setGameplayVisible(true);
      if (!input.usingGamepad) input.requestLock();
      return;
    }
    this.begin();
  }
  toMainMenu() {
    this.cancelPrompt();
    const { game, setArena, audio, input, hud, screen, presentation } = this.ports;
    game.state = 'start';
    game.mode = 'solo';
    game.menu = false;
    setArena(false);
    this.resetGame();
    audio.reelLoop(false);
    input.exitLock();
    hud.setGameplayVisible(false);
    screen.screen = 'main';
    presentation.start();
  }
  toLobbyScreen() {
    this.cancelPrompt();
    this.mapVote.clear();
    const { transport, remote, setArena, game, hud, screen, presentation } = this.ports;
    transport.inMatch = false;
    for (const actor of remote()) actor.lastSeen = performance.now();
    setArena(true);
    this.resetGame();
    game.state = 'lobby';
    game.over = null;
    game.menu = false;
    hud.setGameplayVisible(false);
    hud.setBoard(null);
    screen.screen = 'lobby';
    presentation.start();
  }
  enterLobby() {
    this.ports.game.state = 'lobby';
    this.ports.screen.screen = 'lobby';
    this.ports.presentation.start();
  }
  takeClockAuthority() {
    const { game, screen, lobby } = this.ports;
    game.clockStarted = screen.clockRunning || screen.matchLeft < (lobby.duration ?? FFA_TIME);
    screen.clockT = 0;
  }
  recoverHost(wasInMatch: boolean) {
    const { game, refreshScores, transport } = this.ports;
    transport.inMatch = wasInMatch;
    if (game.state === 'over') {
      this.mapVote.finishAfterMigration();
      return;
    }
    if (wasInMatch) {
      if (game.state !== 'play' && game.state !== 'dying') game.state = 'play';
      refreshScores();
    } else this.enterLobby();
  }
  recoverFollower(wasInMatch: boolean) {
    this.ports.transport.inMatch = wasInMatch;
    if (!wasInMatch) this.enterLobby();
  }
  /** Transport and roster are already cleared by the connection owner. */
  returnOnline() {
    this.cancelPrompt();
    const { game, hud, setArena, screen, presentation } = this.ports;
    if (game.state === 'over' && game.overT < RESULTS_READ_TIME) {
      this.resultsDestination = 'online';
      return;
    }
    this.resultsDestination = null;
    this.mapVote.clear();
    hud.setBoard(null);
    if (game.state !== 'start') {
      game.state = 'start';
      game.mode = 'solo';
      setArena(false);
      this.resetGame();
      hud.setGameplayVisible(false);
    }
    game.menu = false;
    screen.screen = 'online';
    presentation.start();
  }
}
