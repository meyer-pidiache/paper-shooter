import { FOCUS_SCALE } from '../domain/focus.js';
import type { GamePhase } from '../domain/match.js';
import type { LoopPorts } from './loop-contracts.js';

/** Owns variable frame integration and scheduler lifetime, with scoped simulation and view ports. */
export class GameLoop {
  private last: number;
  private lastPhase: GamePhase | null = null;
  private musicHealT = 2;
  private running = false;
  private frameId = 0;
  private stopBackground: (() => void) | null = null;
  private statsStartedAt: number | null = null;
  private statsFrames = 0;
  constructor(private readonly ports: LoopPorts) {
    this.last = ports.scheduling.now();
  }
  readonly tick = (now: number) => {
    if (!this.running) return;
    this.frameId = this.ports.scheduling.request(this.tick);
    this.step(now);
  };
  start() {
    if (this.running) return;
    this.running = true;
    const { scheduling, net } = this.ports;
    this.last = scheduling.now();
    this.frameId = scheduling.request(this.tick);
    this.stopBackground = scheduling.background(() => {
      if (net.active && scheduling.now() - this.last > 300) this.step(scheduling.now());
    }, 250);
  }
  stop() {
    this.running = false;
    this.ports.scheduling.cancel(this.frameId);
    this.stopBackground?.();
    this.stopBackground = null;
    this.statsStartedAt = null;
    this.statsFrames = 0;
  }
  private sampleNerdStats(now: number) {
    const stats = this.ports.stats;
    const phase = this.ports.game.state;
    if (!stats?.enabled() || (phase !== 'play' && phase !== 'dying')) {
      this.statsStartedAt = null;
      this.statsFrames = 0;
      return;
    }
    if (this.statsStartedAt == null) {
      this.statsStartedAt = now;
      this.statsFrames = 0;
      const ping = stats.ping();
      this.ports.hud.setNerdStats?.(null, ping.value, ping.label);
      return;
    }
    const elapsed = now - this.statsStartedAt;
    if (elapsed > 2500) {
      this.statsStartedAt = now;
      this.statsFrames = 0;
      const ping = stats.ping();
      this.ports.hud.setNerdStats?.(null, ping.value, ping.label);
      return;
    }
    this.statsFrames++;
    if (elapsed < 1000) return;
    const ping = stats.ping();
    this.ports.hud.setNerdStats?.((this.statsFrames * 1000) / elapsed, ping.value, ping.label);
    this.statsStartedAt = now;
    this.statsFrames = 0;
  }
  step(now: number) {
    const { game, input, online, interaction, presentation, actions } = this.ports;
    // Preserve the captured phase, variable step and 50 ms cap, including transitions during input.
    const elapsed = Math.max(0, (now - this.last) / 1000);
    const dt = Math.min(0.05, elapsed);
    this.last = now;
    input.update(dt);
    const phase = game.state;
    const previousPhase = this.lastPhase;
    this.lastPhase = phase;
    const playing = phase === 'play' || phase === 'dying';
    interaction.update(phase, playing, dt);
    const scale = this.timeScale(dt);
    if (phase === 'play' && !online()) actions.updateFocus(dt);
    else actions.endFocus();
    if (playing) {
      const clockElapsed = previousPhase === 'play' || previousPhase === 'dying' ? elapsed : dt;
      this.simulate(phase, dt, dt * scale, clockElapsed);
    } else this.idle(phase, dt);
    if (phase === 'over') actions.updateResults(previousPhase === 'over' ? elapsed : 0);
    actions.updateTabProtection?.();
    presentation.present(playing, dt, scale);
    if (this.running) this.sampleNerdStats(now);
  }
  private timeScale(dt: number) {
    const { game } = this.ports;
    if (game.hitstopT > 0) {
      game.hitstopT -= dt;
      return game.hitstopScale;
    }
    return game.focus.active ? FOCUS_SCALE : 1;
  }
  private recoverMusic(phase: GamePhase, dt: number) {
    this.musicHealT -= dt;
    if (this.musicHealT > 0) return;
    this.musicHealT = 2;
    const { audio, musicWanted, audioReady, input } = this.ports;
    if (musicWanted() && phase === 'play' && !audio.musicPlaying && audioReady())
      audio.musicOn(true);
    if (input.anyInput) audio.resume();
  }
  private enforceBounds() {
    const bounds = this.ports.bounds();
    const point = this.ports.player.body.pos;
    if (
      point.x < bounds.minX - 8 ||
      point.x > bounds.maxX + 8 ||
      point.z < bounds.minZ - 8 ||
      point.z > bounds.maxZ + 8 ||
      point.y > 150
    )
      point.y = -100;
  }
  private combo(dt: number) {
    const { game, hud } = this.ports;
    if (game.comboT <= 0) return;
    game.comboT -= dt;
    if (game.comboT <= 0) {
      game.combo = 0;
      hud.setScore(game.score, 0);
    }
  }
  private simulate(phase: GamePhase, dt: number, scaled: number, clockElapsed: number) {
    const { game, player, enemies, effects, actions, online } = this.ports;
    game.time += scaled;
    if (player.shieldT > 0) player.shieldT -= dt;
    this.recoverMusic(phase, dt);
    this.enforceBounds();
    player.update(scaled);
    enemies.update(scaled);
    effects.update(scaled);
    actions.updatePickups(scaled);
    actions.netUpdate(dt, clockElapsed);
    if (phase === 'play' && !online()) actions.updateWaves(scaled);
    if (online()) actions.updateArenaPickups(dt);
    this.combo(scaled);
    actions.updateDeath(phase, dt);
  }
  private idle(phase: GamePhase, dt: number) {
    const { game, player, effects, net, actions } = this.ports;
    game.time += dt;
    if (['start', 'dead', 'lobby', 'over'].includes(phase)) player.idleCam(game.time);
    effects.update(dt);
    if (net.active) actions.netUpdate(dt);
  }
}
