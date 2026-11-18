import type { GamePhase } from '../domain/match.js';
export interface InteractionPorts {
  input: {
    readonly usingGamepad: boolean;
    readonly pointerLocked: boolean;
    pressed(action: string): boolean;
    down(action: string): boolean;
    exitLock(): void;
  };
  hud: { tip(message: string, duration: number): void; setBoard(html: string | null): void };
  online(): boolean;
  menuOpen(): boolean;
  settingsOpen(): boolean;
  screenClick(): void;
  resume(): void;
  pause(): void;
  toggleMusic(): boolean;
  boardVisible(): boolean;
  boardHTML(): string;
}
/** Owns frame-level interaction toggles/hints; session commands own resulting phase changes. */
export class FrameInteraction {
  private boardToggle = false;
  private lockTipT = 0.5;
  constructor(private readonly ports: InteractionPorts) {}
  update(phase: GamePhase, playing: boolean, dt: number) {
    if (!this.ports.settingsOpen()) {
      this.menuInput(phase);
      if (this.ports.input.pressed('music')) {
        const wanted = this.ports.toggleMusic();
        this.ports.hud.tip(wanted ? 'music on' : 'music off', 1.5);
      }
    }
    this.board(playing);
    this.cursorHint(phase, dt);
  }
  private menuInput(phase: GamePhase) {
    const { input, online, menuOpen, screenClick, resume, pause } = this.ports;
    if (['start', 'pause', 'dead'].includes(phase)) {
      if (this.confirmed(phase)) screenClick();
      return;
    }
    if ((phase === 'play' || (phase === 'dying' && online())) && input.pressed('pause')) {
      if (menuOpen()) resume();
      else {
        pause();
        input.exitLock();
      }
      return;
    }
    if (
      (phase === 'play' || phase === 'dying') &&
      menuOpen() &&
      (input.pressed('jump') || input.pressed('confirm'))
    )
      resume();
  }
  private confirmed(phase: GamePhase) {
    const { input } = this.ports;
    return (
      input.pressed('jump') ||
      input.pressed('confirm') ||
      (phase === 'pause' && input.pressed('pause'))
    );
  }
  private board(playing: boolean) {
    const { input, online, menuOpen, boardVisible, boardHTML, hud } = this.ports;
    if (!online() || !playing) {
      this.boardToggle = false;
      return;
    }
    if (input.usingGamepad && input.pressed('score')) this.boardToggle = !this.boardToggle;
    const wanted =
      ((input.down('score') && !input.usingGamepad) || this.boardToggle) && !menuOpen();
    if (wanted !== boardVisible()) hud.setBoard(wanted ? boardHTML() : null);
  }
  private cursorHint(phase: GamePhase, dt: number) {
    const { input, menuOpen, hud } = this.ports;
    if (phase !== 'play' || menuOpen() || input.pointerLocked || input.usingGamepad) return;
    this.lockTipT -= dt;
    if (this.lockTipT <= 0) {
      this.lockTipT = 2.5;
      hud.tip('click the page to grab the mouse', 2);
    }
  }
}
