import type { Vector3 } from 'three';
import { PropCombat } from '../gameplay/combat/props.js';
import { PropFeedback } from '../presentation/prop-feedback.js';
import { PvpDamage } from '../gameplay/combat/pvp-damage.js';
import { GrenadeBlast } from '../gameplay/combat/grenade-blast.js';
import { RopeCuts } from '../gameplay/combat/rope-cuts.js';
import { PlayerQueries } from '../gameplay/combat/player-queries.js';
import type { CombatPorts, CombatActions } from './combat-contracts.js';
import { INK } from '../shared/ink.js';
/** Checked policy composition; no mutable runtime/context registration or controller callbacks. */
export function createCombat(ports: CombatPorts, actions: CombatActions) {
  const { player, remote, online, world, effects, audio, hud, input, net, inMatch, shotQueue } =
    ports;
  const canHurt = (target: object) =>
    online() &&
    target !== player &&
    (!('id' in target) || typeof target.id !== 'string' || (ports.canAttack?.(target.id) ?? true));
  const queries = new PlayerQueries(() => remote.values(), canHurt, world);
  const pvp = new PvpDamage({
    canHurt,
    local: player,
    postponeMelee: ports.postponeMelee,
    hitstop: ports.hitstop,
    effects,
    audio,
    hud,
    rumble: (strong, weak, duration) => input.rumble(strong, weak, duration),
    reportGuard: (id, returned) =>
      net.sendTo(id, 'parry', { ret: returned, by: net.id ?? undefined }),
    reportDamage: (id, amount, origin, critical, source) =>
      net.sendTo(id, 'pdmg', {
        amount: Math.round(amount),
        from: [+origin.x.toFixed(1), +origin.y.toFixed(1), +origin.z.toFixed(1)],
        by: net.id ?? undefined,
        crit: critical,
        src: source,
      }),
  });
  const ropes = new RopeCuts(
    () => [...remote.values()].filter(canHurt),
    (id, point) => {
      effects.strokeBurst(point, INK.ORANGE, 10, 5, { life: 0.25, size: 0.035 });
      net.sendTo(id, 'cut', {});
      hud.tip('ROPE CUT', 0.9);
    },
  );
  const props = new PropCombat({
    props: ports.props,
    lookup: ports.lookupProp,
    world,
    feedback: new PropFeedback(ports.scene, ports.resources, effects, audio),
    canDrop: () => !net.active || net.isHost,
    dropHealth: (point) => actions.spawnPickup('health', point),
    solo: ports.solo,
    score: ports.score,
    broken: (id) => {
      if (net.active) net.broadcast('brk', { id });
    },
  });
  const blast = new GrenadeBlast({
    local: player,
    targets: ports.targets,
    canHurt,
    present: (point, radius) => {
      effects.boom(point, radius);
      audio.explosion(point);
      input.rumble(0.9, 0.9, 220);
    },
    enemies: ports.blastEnemies,
    props: (point, radius) => props.blast(point, radius),
  });
  player.grenadeSystem.onExplosion = (point, mine, sender) =>
    blast.explode(point, mine, mine || !sender || (ports.canAttack?.(sender) ?? true));
  const onShot = (end: Vector3) => {
    if (net.active && inMatch())
      shotQueue.push(+end.x.toFixed(1), +end.y.toFixed(1), +end.z.toFixed(1));
  };
  return {
    canHurt,
    onShot,
    raycastPlayers: queries.raycast.bind(queries),
    playersInArc: queries.inArc.bind(queries),
    hitPlayer: pvp.hit.bind(pvp),
    cutRopes: ropes.cut.bind(ropes),
    breakHit: props.damage.bind(props),
    breakablesInArc: props.inArc.bind(props),
    blastBreakables: props.blast.bind(props),
    breakProp: props.break.bind(props),
  };
}
export type Combat = ReturnType<typeof createCombat>;
