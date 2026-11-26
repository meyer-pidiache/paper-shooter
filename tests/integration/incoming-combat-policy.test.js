// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { applicationFixture } from '../support/application.js';
let fixture;
afterEach(() => {
  fixture?.app.dispose();
  fixture = null;
});
function setup() {
  fixture = applicationFixture();
  fixture.net.id = 'local';
  fixture.net.isHost = true;
  fixture.game.mode = 'ffa';
  fixture.game.state = 'play';
  return fixture;
}
it('records damage attribution before applying an unshielded live-match hit, preserving all guards', () => {
  const { net, player, game } = setup();
  const alive = vi.spyOn(player, 'alive', 'get').mockReturnValue(true);
  player.shieldT = 0;
  const seen = [];
  const damage = vi.spyOn(player, 'takeDamage').mockImplementation((amount, point) =>
    seen.push({
      amount,
      point: point?.toArray(),
      by: player.lastHitBy,
      receipt: player.lastHit,
    }),
  );
  const payload = { amount: 25, from: [1, 2, 3], crit: true, src: 'rifle' };
  player.shieldT = 1;
  net._emit('pdmg', payload, 'attacker');
  player.shieldT = 0;
  alive.mockReturnValue(false);
  net._emit('pdmg', payload, 'attacker');
  alive.mockReturnValue(true);
  game.state = 'dying';
  net._emit('pdmg', payload, 'attacker');
  expect(damage).not.toHaveBeenCalled();
  game.state = 'play';
  net._emit('pdmg', payload, 'attacker');
  expect(seen).toEqual([
    {
      amount: 25,
      point: [1, 2, 3],
      by: 'attacker',
      receipt: {
        from: [1, 2, 3],
        crit: true,
        amount: 25,
        src: 'rifle',
      },
    },
  ]);
  net._emit('pdmg', { amount: 10 }, 'other');
  expect(seen[1]).toEqual({
    amount: 10,
    point: undefined,
    by: 'other',
    receipt: { from: null, crit: false, amount: 10, src: undefined },
  });
});
it('orders remote death presentation local kill credit and host tally, preserving follower feed-only scoring', () => {
  const { app, net, audio, hud, scores, game, lobby, userSettings } = setup();
  userSettings.setPlayerColor('blue');
  const victim = app.multiplayer.addRemote('victim', 'paper');
  const events = [];
  vi.spyOn(victim, 'ragdoll').mockImplementation((direction, over) =>
    events.push(['ragdoll', direction?.toArray(), over]),
  );
  vi.spyOn(audio, 'enemyDie').mockImplementation(() => events.push(['sound']));
  vi.spyOn(game, 'addScore').mockImplementation((...args) => events.push(['credit', ...args]));
  vi.spyOn(audio, 'kill').mockImplementation((...args) => events.push(['kill', ...args]));
  vi.spyOn(app.match, 'tallyDeath').mockImplementation((...args) =>
    events.push(['tally', ...args]),
  );
  vi.spyOn(hud, 'kill').mockImplementation((...args) => events.push(['feed', ...args]));
  net._emit(
    'pdead',
    { killer: 'local', dir: [0, 1, 0], over: true, how: 'rifle', crit: true },
    'victim',
  );
  expect(events).toEqual([
    ['ragdoll', [0, 1, 0], true],
    ['sound'],
    ['credit', 100, { killer: 'You', color: 'blue', after: ' erased paper · rifle headshot' }],
    ['kill', true],
    ['tally', 'victim', 'local'],
  ]);
  expect(game.kills).toBe(1);
  net.isHost = false;
  scores.set('other', { name: 'ink', kills: 0, deaths: 0 });
  lobby.players.set('other', { name: 'ink', color: 'graphite' });
  events.length = 0;
  net._emit('pdead', { killer: 'other' }, 'victim');
  expect(events).toEqual([
    ['ragdoll', undefined, false],
    ['sound'],
    ['feed', { killer: 'ink', color: 'graphite', after: ' erased paper' }, 0],
  ]);
  expect(game.kills).toBe(1);
  events.length = 0;
  net._emit('pdead', {}, 'missing');
  expect(events).toEqual([['feed', 'someone fell off the page', 0]]);
});
it('keeps remote shot origin widths and presentation order and ignores dead or retired actors', () => {
  const { app, net, audio, effects } = setup();
  const actor = app.multiplayer.addRemote('guest', 'paper');
  actor.body.pos.set(1, 2, 3);
  actor.right.set(1, 0, 0);
  actor.forward.set(0, 0, -1);
  const events = [];
  vi.spyOn(effects, 'tracer').mockImplementation((from, to, ink, width, life) =>
    events.push(['tracer', from.toArray(), to.toArray(), ink, width, life]),
  );
  vi.spyOn(actor, 'flash').mockImplementation(() => events.push(['flash']));
  vi.spyOn(audio, 'remoteShot').mockImplementation((kind, origin) =>
    events.push(['sound', kind, origin.toArray()]),
  );
  net._emit('shots', { k: 'shotgun', e: [4, 5, 6, 7, 8, 9] }, 'guest');
  expect(events).toEqual([
    ['tracer', [1.3, 3.35, 2.2], [4, 5, 6], 0, 0.014, 0.06],
    ['tracer', [1.3, 3.35, 2.2], [7, 8, 9], 0, 0.014, 0.06],
    ['flash'],
    ['sound', 'shotgun', [1.3, 3.35, 2.2]],
  ]);
  events.length = 0;
  actor.alive = false;
  net._emit('shots', { k: 'rifle', e: [4, 5, 6] }, 'guest');
  actor.alive = true;
  actor.root = null;
  net._emit('shots', { k: 'sniper', e: [4, 5, 6] }, 'guest');
  net._emit('shots', { k: 'rifle', e: [4, 5, 6] }, 'missing');
  expect(events).toEqual([]);
});
