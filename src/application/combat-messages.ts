import { Vector3 } from 'three';
import type { GamePayloads } from '../network/game-message-types.js';
import type { GamePhase, Score } from '../domain/match.js';
import type { PlayerHitReceipt } from '../gameplay/player/services.js';
import type { KillFeedEntry } from '../presentation/kill-feed.js';
import type { CharacterColor } from '../shared/character-color.js';
export interface CombatMessagePeer {
  readonly name: string;
  readonly center: Vector3;
  ragdoll(direction: Vector3 | null, over: boolean): void;
}
export interface CombatMessagePorts {
  player: {
    readonly alive: boolean;
    readonly shieldT: number;
    lastHitBy: string | null;
    lastHit: PlayerHitReceipt | null;
    readonly grapple: { readonly state: string };
    readonly center: Vector3;
    takeDamage(amount: number, from: Vector3 | null): void;
    throwGrenade(data: GamePayloads['nade']): void;
    detachGrapple(jump: boolean): void;
  };
  game: {
    readonly state: GamePhase;
    kills: number;
    addScore(points: number, label: KillFeedEntry): void;
  };
  transport: { readonly id: string | null; readonly isHost: boolean };
  scores: ReadonlyMap<string, Score>;
  colorFor(id: string): CharacterColor | undefined;
  opponents: ReadonlyMap<string, CombatMessagePeer>;
  feedback: {
    death(point: Vector3): void;
    kill(): void;
    feed(text: KillFeedEntry): void;
    parry(returned: boolean): void;
    cut(): void;
  };
  canReceiveDamage?(sender: string): boolean;
  tally(victim: string, killer?: string | null): void;
}
/** Applies already validated combat messages; transport decoding and views have separate owners. */
export class CombatMessages {
  constructor(private readonly ports: CombatMessagePorts) {}
  damage(data: GamePayloads['pdmg'], sender: string) {
    const { player, game } = this.ports;
    if (
      !player.alive ||
      game.state !== 'play' ||
      player.shieldT > 0 ||
      this.ports.canReceiveDamage?.(sender) === false
    )
      return;
    player.lastHitBy = sender || null;
    player.lastHit = {
      from: data.from || null,
      crit: !!data.crit,
      amount: data.amount,
      src: data.src,
    };
    player.takeDamage(data.amount, data.from ? new Vector3().fromArray(data.from) : null);
  }
  death(data: GamePayloads['pdead'], sender: string) {
    const { opponents, scores, transport, feedback, game, tally, colorFor } = this.ports;
    const opponent = opponents.get(sender);
    const victimName = opponent?.name || scores.get(sender)?.name || 'someone';
    const killerName = data.killer
      ? scores.get(data.killer)?.name || opponents.get(data.killer)?.name
      : null;
    if (opponent) {
      opponent.ragdoll(data.dir ? new Vector3().fromArray(data.dir) : null, !!data.over);
      feedback.death(opponent.center);
    }
    const how = data.how ? ' · ' + data.how + (data.crit ? ' headshot' : '') : '';
    const credit = {
      color: data.killer ? colorFor(data.killer) : undefined,
      after: ' erased ' + victimName + how,
    };
    if (data.killer && data.killer === transport.id) {
      game.kills++;
      game.addScore(100, { killer: killerName || 'You', ...credit });
      feedback.kill();
    } else
      feedback.feed(
        killerName ? { killer: killerName, ...credit } : victimName + ' fell off the page',
      );
    if (transport.isHost) tally(sender, data.killer);
  }
  grenade(data: GamePayloads['nade']) {
    this.ports.player.throwGrenade(data);
  }
  parry(data: GamePayloads['parry']) {
    this.ports.feedback.parry(!!data.ret);
  }
  cut() {
    const { player, feedback } = this.ports;
    if (player.grapple.state === 'idle') return;
    player.detachGrapple(false);
    feedback.cut();
  }
}
