// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { applicationFixture } from '../support/application.js';
import baseline from '../fixtures/focus-baseline.json';

let fixture;
afterEach(() => {
  fixture?.app.dispose();
  fixture = null;
  vi.clearAllTimers();
  vi.useRealTimers();
});
const number = (value) => +value.toFixed(10);
const vector = (value) => value.toArray().map(number);
it('preserves focus arming, chained execution, player movement and ordered presentation', () => {
  vi.useFakeTimers();
  fixture = applicationFixture('mexico');
  const { app, game, player, enemies, world, input, effects, resources, frame, hud } = fixture;
  app.session.begin();
  world.clear();
  world.addBox({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 });
  world.finalize();
  player.body.pos.set(0, 0, 0);
  player._updateCamera(0.01);
  player.hp = 80;
  const targets = [-8, -14].map((z) => {
    const enemy = enemies.spawn('grunt', new Vector3(0, 0, z));
    enemy.state = 'hunt';
    enemy.center.set(0, 1, z);
    return enemy;
  });
  const feedback = [];
  for (const method of ['setFocusMark', 'tip', 'kill']) {
    const original = hud[method].bind(hud);
    vi.spyOn(hud, method).mockImplementation((...args) => {
      feedback.push([method, ...args]);
      return original(...args);
    });
  }
  const frames = [];
  function capture(label) {
    const focus = game.focus;
    const blade = player.weapons[player.katanaIndex];
    blade.root.updateMatrixWorld(true);
    frames.push({
      label,
      focus: {
        active: focus.active,
        time: focus.t,
        chain: focus.chain,
        arm: focus.arm,
        ready: focus.ready,
        target: focus.target?.id ?? null,
        dash: focus.dash
          ? {
              target: focus.dash.target.id,
              time: focus.dash.t,
              trail: vector(focus.dash.trail),
              lastTrail: focus.dash.lastTrail,
              stuckY: focus.dash.stuckY ?? null,
            }
          : null,
      },
      player: {
        pos: vector(player.body.pos),
        velocity: vector(player.body.vel),
        yaw: player.yaw,
        pitch: player.pitch,
        hp: player.hp,
        locked: player.dashLock,
        fov: fixture.R.camera.fov,
        blade: blade.root.matrixWorld.elements.map(number),
      },
      targets: targets.map((enemy) => ({
        id: enemy.id,
        alive: enemy.alive,
        hp: enemy.hp,
        pos: vector(enemy.body.pos),
      })),
      score: game.score,
      kills: game.kills,
      streak: game.katanaStreak,
      particles: effects.particles.map((particle) => ({
        kind: particle.kind,
        pos: vector(particle.pos),
        life: particle.life,
        size: particle.size,
      })),
      fragments: effects.debrisList.map((fragment) => ({
        pos: vector(fragment.mesh.position),
        velocity: vector(fragment.vel),
        life: fragment.life,
      })),
      feedback: structuredClone(feedback),
      resources: resources.resourceCount,
      randomCalls: vi.mocked(Math.random).mock.calls.length,
    });
  }
  capture('initial');
  app.focus.enterFocus();
  capture('entered');
  input.keys.dash = true;
  frame(0.05, 4);
  expect(game.focus.dash).toBeNull();
  capture('held-before-release');
  input.keys.dash = false;
  frame(0.05);
  capture('armed');
  input.keys.dash = true;
  frame(0.05);
  capture('first-dash');
  frame(0.05, 8);
  capture('first-execution');
  input.keys.dash = false;
  frame(0.05);
  input.keys.dash = true;
  frame(0.05);
  capture('second-dash');
  frame(0.05, 12);
  capture('second-execution');
  expect(game.kills).toBe(2);
  input.keys.dash = false;
  frame(0.05, 60);
  expect(game.focus.active).toBe(false);
  capture('expired');
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
  if (process.env.RECORD_FOCUS_BASELINE === '1')
    writeFileSync(
      'tests/fixtures/focus-baseline.json',
      JSON.stringify({ source: 'issue-17', ...result }, null, 2) + '\n',
    );
  else {
    if (result.digest !== baseline.digest) {
      mkdirSync('reports', { recursive: true });
      writeFileSync('reports/focus-trace.json', JSON.stringify({ result, frames }));
    }
    const expected = { ...baseline };
    delete expected.source;
    expect(result).toEqual(expected);
  }
});
