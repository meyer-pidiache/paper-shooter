import { expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { CombatMessages, type CombatMessagePorts } from '../../src/application/combat-messages.js';
function fixture() {
  const events: unknown[] = [];
  const record = (name: string) =>
    vi.fn((...args: unknown[]) => {
      events.push([name, ...args]);
    });
  const ports: CombatMessagePorts = {
    player: {
      alive: true,
      shieldT: 0,
      lastHitBy: null,
      lastHit: null,
      grapple: { state: 'pull' },
      center: new Vector3(),
      takeDamage: record('damage'),
      throwGrenade: record('grenade'),
      detachGrapple: record('detach'),
    },
    game: { state: 'play', kills: 0, addScore: record('score') },
    transport: { id: 'local', isHost: true },
    scores: new Map(),
    colorFor: (id) => (id === 'local' ? 'blue' : undefined),
    opponents: new Map(),
    feedback: {
      death: record('death'),
      kill: record('kill'),
      feed: record('feed'),
      parry: record('parry'),
      cut: record('cut'),
    },
    tally: record('tally'),
  };
  return { ports, events, owner: new CombatMessages(ports) };
}
it('applies damage and attribution without a DOM renderer or application runtime', () => {
  const { ports, owner } = fixture();
  const source = [1, 2, 3] satisfies [number, number, number];
  ports.player.takeDamage = vi.fn((amount, point) => {
    expect(amount).toBe(25);
    expect(point?.toArray()).toEqual(source);
    expect(ports.player.lastHitBy).toBe('other');
    expect(ports.player.lastHit).toEqual({ from: source, crit: false, amount: 25, src: undefined });
  });
  owner.damage({ amount: 25, from: source }, 'other');
  expect(ports.player.takeDamage).toHaveBeenCalledOnce();
  expect(source).toEqual([1, 2, 3]);
});
it('keeps grenade parry and rope commands ordered and does not cut an idle rope', () => {
  const { ports, owner, events } = fixture();
  const data = { pos: [1, 2, 3], vel: [4, 5, 6] } satisfies Parameters<
    CombatMessages['grenade']
  >[0];
  owner.grenade(data);
  owner.parry({ ret: true });
  owner.cut();
  expect(events).toEqual([['grenade', data], ['parry', true], ['detach', false], ['cut']]);
  ports.player = { ...ports.player, grapple: { state: 'idle' } };
  owner.cut();
  expect(ports.player.detachGrapple).toHaveBeenCalledOnce();
});
it('credits unknown victims to the local killer and reports host tally after credit', () => {
  const { owner, events, ports } = fixture();
  owner.death({ killer: 'local' }, 'missing');
  expect(events).toEqual([
    ['score', 100, { killer: 'You', color: 'blue', after: ' erased someone' }],
    ['kill'],
    ['tally', 'missing', 'local'],
  ]);
  expect(ports.game.kills).toBe(1);
});
