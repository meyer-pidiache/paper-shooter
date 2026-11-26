import { expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { RopeCuts } from '../../src/gameplay/combat/rope-cuts.js';
import { GrenadeBlast, type GrenadeBlastPorts } from '../../src/gameplay/combat/grenade-blast.js';
function rope(id: string, z = -3) {
  return {
    id,
    alive: true,
    grappling: true,
    body: { pos: new Vector3(0, 0, z) },
    right: new Vector3(1, 0, 0),
    gPoint: new Vector3(0, 5, z - 3),
  };
}
it('reports a rope once, excludes inactive targets and leaves source endpoints unchanged', () => {
  const active = rope('active'),
    dead = rope('dead'),
    idle = rope('idle');
  dead.alive = false;
  idle.grappling = false;
  const hits: { id: string; point: Vector3 }[] = [];
  const cuts = new RopeCuts(
    () => [active, dead, idle],
    (id, point) => {
      hits.push({ id, point: point.clone() });
    },
  );
  const eye = new Vector3(0, 1.6, 0),
    direction = new Vector3(0, 0, -1);
  expect(cuts.cut(eye, direction, 5)).toBe(true);
  expect(hits).toEqual([{ id: 'active', point: new Vector3(0.35, 1.25, -3) }]);
  expect(active.body.pos).toEqual(new Vector3(0, 0, -3));
  expect(active.gPoint).toEqual(new Vector3(0, 5, -6));
  expect(eye).toEqual(new Vector3(0, 1.6, 0));
});
it('ignores rope samples behind, outside reach and away from the slash axis', () => {
  const behind = rope('behind', 8),
    far = rope('far', -30),
    lateral = rope('lateral');
  lateral.body.pos.x = lateral.gPoint.x = 20;
  const cut = vi.fn();
  const cuts = new RopeCuts(() => [behind, far, lateral], cut);
  expect(cuts.cut(new Vector3(0, 1.6, 0), new Vector3(0, 0, -1), 4)).toBe(false);
  expect(cut).not.toHaveBeenCalled();
});
function blastFixture() {
  const events: string[] = [];
  const local = {
    isLocal: true,
    alive: true,
    center: new Vector3(),
    takeDamage: vi.fn(() => {
      events.push('local');
    }),
    knockback: vi.fn((_direction: Vector3, _amount: number) => {
      events.push('knockback');
    }),
  };
  const remote = {
    isLocal: false,
    alive: true,
    center: new Vector3(1, 0, 0),
    takeDamage: vi.fn((_amount: number, _from: Vector3) => {
      events.push('remote');
    }),
  };
  const blocked = { ...remote, takeDamage: vi.fn() },
    dead = { ...remote, alive: false, takeDamage: vi.fn() },
    distant = { ...remote, center: new Vector3(30, 0, 0), takeDamage: vi.fn() };
  const ports: GrenadeBlastPorts = {
    local,
    targets: vi.fn(() => [local, remote, blocked, dead, distant]),
    canHurt: (target) => target !== blocked,
    present: vi.fn(() => {
      events.push('present');
    }),
    enemies: vi.fn(() => {
      events.push('enemies');
    }),
    props: vi.fn(() => {
      events.push('props');
    }),
  };
  return { local, remote, blocked, dead, distant, events, ports, blast: new GrenadeBlast(ports) };
}
it('orders owned blast presentation, enemy/prop damage, local impulse and eligible remote damage', () => {
  const f = blastFixture();
  const point = new Vector3();
  f.blast.explode(point, true);
  expect(f.events).toEqual(['present', 'enemies', 'props', 'local', 'knockback', 'remote']);
  expect(f.ports.enemies).toHaveBeenCalledWith(point, 6.4, 120);
  expect(f.local.takeDamage).toHaveBeenCalledWith(44, point);
  expect(f.local.knockback).toHaveBeenCalledWith(new Vector3(), 9);
  expect(vi.mocked(f.remote.takeDamage).mock.calls[0][0]).toBeCloseTo(
    12 + 50 * (1 - 1 / (6.4 * 0.95)),
  );
  expect(f.blocked.takeDamage).not.toHaveBeenCalled();
  expect(f.dead.takeDamage).not.toHaveBeenCalled();
  expect(f.distant.takeDamage).not.toHaveBeenCalled();
  expect(point).toEqual(new Vector3());
});
it('applies a foreign grenade only to the local player and skips dead or distant locals', () => {
  const f = blastFixture();
  f.blast.explode(new Vector3(), false);
  expect(f.events).toEqual(['present', 'local', 'knockback']);
  expect(f.ports.targets).not.toHaveBeenCalled();
  expect(f.ports.enemies).not.toHaveBeenCalled();
  expect(f.ports.props).not.toHaveBeenCalled();
  f.events.length = 0;
  f.local.alive = false;
  f.blast.explode(new Vector3(), false);
  expect(f.events).toEqual(['present']);
  f.local.alive = true;
  f.local.center.set(20, 0, 0);
  f.events.length = 0;
  f.blast.explode(new Vector3(), false);
  expect(f.events).toEqual(['present']);
});

it('presents an allied foreign grenade without damaging or knocking back the local player', () => {
  const f = blastFixture();
  f.blast.explode(new Vector3(), false, false);
  expect(f.events).toEqual(['present']);
  expect(f.local.takeDamage).not.toHaveBeenCalled();
  expect(f.local.knockback).not.toHaveBeenCalled();
});
