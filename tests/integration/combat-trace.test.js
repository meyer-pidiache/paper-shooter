// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { applicationFixture } from '../support/application.js';
import baseline from '../fixtures/combat-baseline.json';
let fixture;
afterEach(() => {
  fixture?.app.dispose();
  fixture = null;
  vi.clearAllTimers();
  vi.useRealTimers();
});
const number = (value) => +value.toFixed(10);
const vector = (value) => value.toArray().map(number);
it('preserves composed PvP guard, rope, prop, blast and shot-report outcomes', () => {
  vi.useFakeTimers();
  fixture = applicationFixture('mexico');
  const { app, net, player, world, game, state, effects, resources, shotQueue } = fixture;
  const combat = app.combat;
  const packets = [];
  for (const method of ['sendTo', 'broadcast', 'send'])
    vi.spyOn(net, method).mockImplementation((...args) => {
      packets.push([method, ...structuredClone(args)]);
    });
  net.id = 'local';
  net.isHost = true;
  net.connected = true;
  net.peer = { destroy() {} };
  app.session.startMatch(false, 0);
  player.maxHp = player.hp = 10000;
  player.body.pos.set(0, 0, 0);
  player._updateCamera(0.01);
  world.clear();
  world.addBox({ x: -100, y: -1, z: -100 }, { x: 100, y: 0, z: 100 });
  world.finalize();
  const opponent = app.multiplayer.addRemote('opponent', 'paper');
  opponent.push([0, 0, -4, Math.PI, 0, 0, 64 | 16, 100, 0, 0, 0], 0);
  opponent.update(0.02, 0);
  const frames = [];
  function capture(label) {
    const hit = combat.raycastPlayers(
      player.eye,
      opponent.center.clone().sub(player.eye).normalize(),
      30,
    );
    frames.push({
      label,
      local: {
        hp: player.hp,
        pos: vector(player.body.pos),
        vel: vector(player.body.vel),
        hurt: player.hurtFx,
        lastHitBy: player.lastHitBy,
        lastHit: player.lastHit,
      },
      opponent: {
        hp: opponent.hp,
        pos: vector(opponent.body.pos),
        blocking: opponent.blocking,
        parry: opponent.parryWindow,
      },
      hit: hit
        ? {
            id: hit.player.id,
            part: hit.part,
            distance: number(hit.dist),
            point: vector(hit.point),
          }
        : null,
      arc: combat
        .playersInArc(player.eye, player.forward, 20, Math.cos(1))
        .map((target) => target.id),
      props: state.level.breakables.map((prop) => ({
        id: prop.id,
        hp: prop.hp,
        alive: prop.alive,
        kind: prop.kind,
      })),
      pickups: state.pickups.map((pickup) => ({
        id: pickup.id,
        kind: pickup.kind,
        position: vector(pickup.mesh.position),
      })),
      score: game.score,
      kills: game.kills,
      enemies: fixture.enemies.enemies.map((enemy) => ({
        id: enemy.id,
        hp: enemy.hp,
        alive: enemy.alive,
      })),
      packets: structuredClone(packets),
      shots: shotQueue.slice(),
      particles: effects.particles.map((particle) => ({
        kind: particle.kind,
        position: vector(particle.pos),
        velocity: particle.vel ? vector(particle.vel) : null,
        life: number(particle.life),
        ink: particle.ink,
        size: particle.size,
      })),
      fragments: effects.debrisList.map((fragment) => ({
        position: vector(fragment.mesh.position),
        rotation: [
          fragment.mesh.rotation.x,
          fragment.mesh.rotation.y,
          fragment.mesh.rotation.z,
        ].map(number),
        velocity: vector(fragment.vel),
        angular: vector(fragment.ang),
        life: number(fragment.life),
        radius: fragment.radius,
        blood: fragment.blood,
      })),
      shake: number(effects.shakeAmt),
      resources: resources.resourceCount,
      randomCalls: vi.mocked(Math.random).mock.calls.length,
    });
    expect(Number.isFinite(player.hp)).toBe(true);
    expect(player.body.vel.toArray().every(Number.isFinite)).toBe(true);
  }
  capture('initial');
  const impact = (part, source = 'rifle') => ({
    point: opponent.center.clone(),
    dir: new Vector3(0, 0, -1),
    part,
    source,
    crit: part === 'head',
  });
  combat.hitPlayer(opponent, 25, impact('torso'));
  player.weapon.fireRay(player.eye, opponent.center.clone().sub(player.eye).normalize());
  capture('unblocked-hit-and-shot');
  opponent.blocking = true;
  for (let attempt = 0; attempt < 10; attempt++) combat.hitPlayer(opponent, 30, impact('blade'));
  const parries = packets.filter((packet) => packet[2] === 'parry').map((packet) => packet[3].ret);
  expect(new Set(parries)).toEqual(new Set([true, false]));
  capture('blade-deflection');
  opponent.parryWindow = true;
  combat.hitPlayer(opponent, 55, impact('torso', 'katana'));
  capture('slash-parried');
  opponent.parryWindow = false;
  combat.hitPlayer(opponent, 55, impact('torso', 'katana'));
  opponent.grappling = true;
  opponent.gPoint.set(0, 5, -8);
  expect(combat.cutRopes(player.eye, player.forward, 10)).toBe(true);
  capture('unguarded-slash-and-rope-cut');
  const seen = new Set();
  for (const prop of state.level.breakables)
    if (!seen.has(prop.kind)) {
      seen.add(prop.kind);
      combat.breakHit(prop, 1, prop.pos.clone(), new Vector3(1, 0.3, -1));
      combat.breakHit(prop, 10000, prop.pos.clone(), new Vector3(1, 0.3, -1));
    }
  capture('prop-kinds');
  const quiet = state.level.breakables.find((prop) => prop.alive);
  if (quiet) app.combat.breakProp(quiet, null, false, true);
  const solo = state.level.breakables.find((prop) => prop.kind === 'pinata' && prop.alive);
  if (solo) {
    game.mode = 'solo';
    app.combat.breakProp(solo, null, true);
    game.mode = 'ffa';
  }
  capture('quiet-and-solo-prop');
  const enemy = fixture.enemies.spawn('grunt', new Vector3(2, 0, -2));
  fixture.enemies.update(0.8);
  const hpBeforeBlast = enemy.hp;
  player.grenadeSystem.onExplosion(new Vector3(0, 1, -2), true);
  expect(enemy.hp).toBeLessThan(hpBeforeBlast);
  const hpAfterOwned = enemy.hp;
  capture('owned-blast');
  player.grenadeSystem.onExplosion(new Vector3(0, 1, -2), false);
  capture('foreign-blast');
  expect(enemy.hp).toBe(hpAfterOwned);
  const messages = packets.length;
  game.mode = 'solo';
  combat.hitPlayer(opponent, 500, impact('head'));
  expect(packets.length).toBe(messages);
  for (let frame = 0; frame < 80; frame++) effects.update(0.03);
  capture('effects-progress');
  const result = {
    frames: frames.length,
    digest: createHash('sha256')
      .update(
        JSON.stringify(frames, (_key, value) =>
          typeof value === 'number' ? number(value) : value,
        ),
      )
      .digest('hex'),
    randomCalls: vi.mocked(Math.random).mock.calls.length,
  };
  if (process.env.RECORD_COMBAT_BASELINE === '1')
    writeFileSync(
      'tests/fixtures/combat-baseline.json',
      JSON.stringify({ source: 'issue-17', ...result }, null, 2) + '\n',
    );
  else {
    if (result.digest !== baseline.digest) {
      mkdirSync('reports', { recursive: true });
      writeFileSync('reports/combat-trace.json', JSON.stringify({ result, frames }));
    }
    const expected = { ...baseline };
    delete expected.source;
    expect(result).toEqual(expected);
  }
});
