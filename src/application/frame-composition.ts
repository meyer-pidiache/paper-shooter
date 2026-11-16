import { FrameInteraction } from './frame-interaction.js';
import type { InteractionPorts } from './frame-interaction.js';
import { FramePresentation } from '../presentation/frame.js';
import type { FrameDisplayPorts } from '../presentation/frame.js';
import { browserFrames } from '../platform/frame-scheduling.js';
import { GameLoop } from './loop.js';
import type { LoopPorts, FrameScheduling } from './loop-contracts.js';

interface FrameServices {
  game: LoopPorts['game'] & FrameDisplayPorts['game'] & { readonly menu: boolean };
  player: LoopPorts['player'] & FrameDisplayPorts['player'];
  input: LoopPorts['input'] & InteractionPorts['input'];
  hud: LoopPorts['hud'] & FrameDisplayPorts['hud'] & InteractionPorts['hud'];
  audio: LoopPorts['audio'] & FrameDisplayPorts['audio'];
  renderer: FrameDisplayPorts['renderer'];
  enemies: LoopPorts['enemies'] & { readonly alive: number };
  effects: LoopPorts['effects'];
  net: LoopPorts['net'];
  online(): boolean;
  level(): {
    bounds: ReturnType<LoopPorts['bounds']>;
    animated: ReturnType<FrameDisplayPorts['animations']>;
  };
  musicWanted(): boolean;
  audioReady(): boolean;
  remoteCount(): number;
  clearBoss(): void;
  toggleMusic(): boolean;
  boardVisible(): boolean;
  screenClick(): void;
  scheduling?: FrameScheduling;
  stats?: LoopPorts['stats'];
}
type FrameActions = LoopPorts['actions'] & Pick<InteractionPorts, 'resume' | 'pause' | 'boardHTML'>;
/** Checked composition of independent frame owners; accepts consumed capabilities, never runtime. */
export function createLoop(ports: FrameServices, actions: FrameActions) {
  const { game, player, input, hud, audio, renderer, enemies, effects, net, online } = ports;
  const interaction = new FrameInteraction({
    input,
    hud,
    online,
    menuOpen: () => game.menu,
    screenClick: ports.screenClick,
    resume: actions.resume,
    pause: actions.pause,
    toggleMusic: ports.toggleMusic,
    boardVisible: ports.boardVisible,
    boardHTML: actions.boardHTML,
  });
  const presentation = new FramePresentation({
    game,
    player,
    hud,
    audio,
    renderer,
    animations: () => ports.level().animated,
    online,
    enemiesAlive: () => enemies.alive,
    remoteCount: ports.remoteCount,
    clearBoss: ports.clearBoss,
  });
  return new GameLoop({
    game,
    player,
    input,
    enemies,
    effects,
    hud,
    net,
    audio,
    online,
    musicWanted: ports.musicWanted,
    audioReady: ports.audioReady,
    bounds: () => ports.level().bounds,
    interaction,
    presentation,
    scheduling: ports.scheduling ?? browserFrames,
    stats: ports.stats,
    actions,
  });
}
