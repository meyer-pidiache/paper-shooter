// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { applicationFixture } from '../support/application.js';

let fixture;
afterEach(() => {
  fixture?.app.dispose();
  fixture = null;
  vi.clearAllTimers();
  vi.useRealTimers();
});
function host() {
  vi.useFakeTimers();
  fixture = applicationFixture();
  const { net, lobby, app } = fixture;
  net.id = 'local';
  net.isHost = true;
  net.connected = true;
  net.peer = { destroy() {} };
  lobby.players.set('local', { name: 'player' });
  lobby.players.set('other', { name: '<opponent>' });
  app.session.startMatch(false, 0);
  return fixture;
}

it('wraps a fast mid-match player without resetting health, immunity or scores', () => {
  const { frame, player, game, state, scores } = host();
  const { maxX, minX } = state.level.bounds;
  player.body.pos.set(maxX + 7.8, -1, 17);
  player.body.vel.set(40, 0, 0);
  player.body.onGround = false;
  player.center.copy(player.body.pos);
  player.grapple.state = 'on';
  player.grapple.anchor.set(maxX + 17, 12, 17);
  player.grapple.len = 30;
  player.hp = 61;
  player.regenRate = 0;
  player.shieldT = 0;
  scores.get('local').kills = 3;
  frame();
  expect(player.body.pos.x).toBeCloseTo(minX + 5);
  expect(player.body.vel.x).toBeGreaterThan(0);
  expect(player.grapple.state).toBe('idle');
  expect(player.hp).toBe(61);
  expect(player.shieldT).toBe(0);
  expect(scores.get('local')).toMatchObject({ kills: 3, deaths: 0 });
  frame(1 / 60, 8);
  expect(player.body.pos.x).toBeGreaterThan(minX + 5);
  expect(player.body.pos.x).toBeLessThan(0);
  expect(game.state).toBe('play');

  player.body.pos.y = -13;
  frame();
  expect(player.hp).toBe(41);
  expect(scores.get('local').kills).toBe(2);
});

it('selects among the safest three visible-opponent spawns and includes the local player for late joins', () => {
  const { app, state, player } = host();
  const spots = [0, 10, 20, 30].map((x) => new Vector3(x, 0, 0));
  state.level.arenaSpawns = spots;
  const opponent = app.multiplayer.addRemote('other', 'paper');
  opponent.body.pos.set(0, 0, 0);
  opponent.root.visible = true;
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  const chosen = app.match.arenaSpawn();
  expect(chosen).toEqual(spots[3]);
  expect(chosen).not.toBe(spots[3]);
  random.mockReturnValue(0.999);
  expect(app.match.arenaSpawn()).toEqual(spots[1]);
  player.body.pos.set(30, 0, 0);
  expect(app.match.farthestSpawnIndex()).toBe(1);
  opponent.root.visible = false;
  random.mockReturnValue(0);
  expect(app.match.arenaSpawn()).toEqual(spots[0]);
  expect(app.match.farthestSpawnIndex()).toBe(1);
  state.level.arenaSpawns = [];
  expect(app.match.spawnSpots()).toBe(state.level.spawns);
});

it('shows five scores and a live binding hint only when the compact board omits players', () => {
  const { app, hud, scores, userSettings } = host();
  const leaders = document.querySelector('#pvpscore');
  const rows = () => [...leaders.querySelectorAll('.rank')].map((row) => row.textContent);
  const hint = () => leaders.querySelector('.scoreboard-hint')?.textContent;
  scores.clear();
  for (let index = 0; index < 4; index++)
    scores.set('opponent' + index, { name: 'player' + index, kills: 10 - index, deaths: 0 });
  scores.set('local', { name: 'paper', kills: 1, deaths: 0 });
  app.match.refreshScoreHud();
  expect(rows()).toEqual(['1.', '2.', '3.', '4.', '5.']);
  expect(hint()).toBeUndefined();

  scores.set('other', { name: 'other', kills: 2, deaths: 0 });
  app.match.refreshScoreHud();
  expect(rows()).toEqual(['1.', '2.', '3.', '4.', '6.']);
  expect(leaders.querySelector('.me .name').textContent).toBe('paper (you)');
  expect(app.match.boardHTML()).toContain('other');
  expect(hint()).toBe('Hold Tab for full scoreboard');
  expect(userSettings.setBinding('score', 'key', 'KeyJ')).toBeNull();
  expect(hint()).toBe('Hold J for full scoreboard');
  hud.setDevice(true);
  expect(hint()).toBe('Press Create for full scoreboard');
  hud.setDevice(false);
  expect(hint()).toBe('Hold J for full scoreboard');
});

it('reports death before scoring and preserves headshot, suicide and respawn feedback', () => {
  const { app, player, game, net, scores, hud, lobby } = host();
  const events = [];
  vi.spyOn(net, 'broadcast').mockImplementation((...args) => events.push(['broadcast', ...args]));
  vi.spyOn(net, 'send').mockImplementation((...args) => events.push(['send', ...args]));
  const kill = vi.spyOn(hud, 'kill');
  lobby.players.set('other', { name: '<opponent>', color: 'graphite' });
  player.lastHitBy = 'other';
  player.center.set(1, 2, 3);
  player.lastHit = { from: [1, 2, 4], amount: 25, crit: true, src: 'rifle' };
  app.match.onLocalDeath();
  expect(events.map(([kind, type]) => [kind, type])).toEqual([
    ['broadcast', 'pdead'],
    ['send', 'score'],
  ]);
  expect(events[0][2]).toEqual({
    killer: 'other',
    dir: [0, 0, -1],
    over: true,
    how: 'rifle',
    crit: true,
  });
  expect(scores.get('local').deaths).toBe(1);
  expect(scores.get('other').kills).toBe(1);
  expect(kill).toHaveBeenLastCalledWith(
    {
      before: 'erased by ',
      killer: '<opponent>',
      color: 'graphite',
      after: ' · rifle headshot',
    },
    0,
  );
  expect(game).toMatchObject({ state: 'dying', deathT: 0, respawnT: 2.5 });
  app.match.respawnLocal();
  expect(game.state).toBe('play');
  expect(player).toMatchObject({
    alive: true,
    name: 'player',
    lastHitBy: null,
    lastHit: null,
    shieldT: 2,
  });
  player.lastHitBy = 'local';
  player.lastHit = { amount: 100, src: 'unknown' };
  app.match.onLocalDeath();
  expect(scores.get('local')).toMatchObject({ kills: 0, deaths: 2 });
  expect(events.at(-2)[2]).toEqual({
    killer: 'local',
    dir: null,
    over: true,
    how: null,
    crit: false,
  });
});

it('rejects malformed scores, escapes player names and announces the winner', () => {
  const { app, net, scores, hud, state, game } = host();
  const rows = [
    { id: 'one', name: '<one>', kills: 7, deaths: 1 },
    { id: 'two', name: 'two', kills: 6, deaths: 3 },
    { id: 'three', name: 'three', kills: 6, deaths: 2 },
    { id: 'local', name: '<local>', kills: 4, deaths: 1 },
    { id: 'five', name: 'five', kills: 1, deaths: 1 },
  ];
  hud.setBoard('open');
  app.match.applyScores(rows);
  expect(app.match.sortedScores().map(([id]) => id)).toEqual([
    'one',
    'three',
    'two',
    'local',
    'five',
  ]);
  expect(hud.el.board.innerHTML).toBe(app.match.boardHTML());
  expect(hud.el.board.querySelector('one')).toBeNull();
  const scoreHud = vi.spyOn(hud, 'setPvpScore');
  app.match.refreshScoreHud();
  expect(scoreHud.mock.lastCall[0]).toContain('&lt;local&gt; (you)');
  expect(scoreHud.mock.lastCall[0]).toContain('five');
  app.match.applyScores([{ id: 'bad', name: 'bad', kills: -1, deaths: 0 }]);
  expect(scores.size).toBe(5);
  state.matchLeft = 59.1;
  net.aliasCode = 'ABCDE-2';
  expect(app.match.boardHTML('<title>')).toContain('&lt;title&gt;');
  expect(app.match.boardHTML()).toContain('1:00 left · lobby ABCDE');
  const end = vi.spyOn(net, 'send');
  scores.get('local').kills = 20;
  net.isHost = false;
  app.match.checkWin();
  expect(game.over).toBeNull();
  net.isHost = true;
  app.match.checkWin();
  expect(end).toHaveBeenLastCalledWith('end', { id: 'local', name: '<local>', voteId: 1 });
  expect(game).toMatchObject({ state: 'over', overT: 0, over: { id: 'local', name: '<local>' } });
  expect(hud.el.panel.textContent).toContain('YOU WIN');
  expect(hud.el.board.hidden).toBe(true);
  end.mockClear();
  app.match.checkWin();
  expect(end).not.toHaveBeenCalled();
});

it('keeps solo death separate from network scoring and defers respawn until fresh input', () => {
  const { app, game, net, input, player } = host();
  const broadcast = vi.spyOn(net, 'broadcast');
  game.mode = 'solo';
  app.match.onLocalDeath();
  expect(broadcast).not.toHaveBeenCalled();
  expect(game).toMatchObject({ state: 'dying', deathT: 0 });
  game.mode = 'ffa';
  player.takeDamage(1000, null);
  game.respawnT = 0.01;
  fixture.frame(0.05);
  expect(game.state).toBe('dying');
  const armed = game.respawnArm;
  fixture.frame(0.05);
  expect(game.state).toBe('dying');
  input.lastActive = armed + 1;
  fixture.frame(0.05);
  expect(game.state).toBe('play');
  expect(player.alive).toBe(true);
});

it('keeps the host in the results phase when its death awards the winning kill', () => {
  const { game, player, scores, hud } = host();
  scores.get('other').kills = 19;
  player.lastHitBy = 'other';
  player.lastHit = { amount: 1000, src: 'rifle' };
  player.takeDamage(1000, null);
  expect(scores.get('other').kills).toBe(20);
  expect(game.over).toEqual({ id: 'other', name: '<opponent>' });
  expect(game.state).toBe('over');
  expect(hud.el.panel.textContent).toContain('<opponent> WINS');
  fixture.frame(0.05, 60);
  expect(game.state).toBe('over');
  expect(player.alive).toBe(false);
});

it('ends a team match on combined kills and does not credit allied kills', () => {
  const { app, lobby, scores, game } = host();
  lobby.mode = 'teams';
  scores.set('local', { name: 'player', team: 'red', kills: 10, deaths: 0 });
  scores.set('ally', { name: 'ally', team: 'red', kills: 9, deaths: 0 });
  scores.set('other', { name: 'opponent', team: 'blue', kills: 0, deaths: 0 });
  app.match.tallyDeath('local', 'ally');
  expect(scores.get('ally').kills).toBe(9);
  expect(game.state).toBe('play');
  app.match.tallyDeath('other', 'ally');
  expect(game.over).toEqual({ id: 'team-red', name: 'RED TEAM' });
  expect(game.state).toBe('over');
});

it('blocks allied simulated grenade blast damage on the receiving client while allowing enemy grenades', () => {
  const { net, lobby, player } = host();
  lobby.mode = 'teams';
  lobby.players.set('local', { name: 'player', team: 'red' });
  lobby.players.set('ally', { name: 'ally', team: 'red' });
  lobby.players.set('other', { name: 'opponent', team: 'blue' });
  player.shieldT = 0;
  player.hp = 100;
  player.body.vel.set(0, 0, 0);
  const pos = [player.center.x, player.center.y, player.center.z];

  net._emit('nade', { pos, vel: [0, 0, 0] }, 'ally');
  expect(player.grenadeSystem.projectiles).toHaveLength(1);
  player.grenadeSystem.projectiles[0].fuse = 0;
  player.grenadeSystem.update(0.02);
  expect(player.hp).toBe(100);
  expect(player.body.vel.length()).toBe(0);

  net._emit('nade', { pos, vel: [0, 0, 0] }, 'other');
  expect(player.grenadeSystem.projectiles).toHaveLength(1);
  player.grenadeSystem.projectiles[0].fuse = 0;
  player.grenadeSystem.update(0.02);
  expect(player.hp).toBeLessThan(100);
});

it('rebalances at rematch start if the last opponent left during results', () => {
  const { app, game, lobby, net, scores } = host();
  lobby.mode = 'teams';
  lobby.players.set('local', { name: 'player', team: 'red' });
  lobby.players.set('other', { name: 'guest', team: 'red' });
  lobby.players.set('blue', { name: 'opponent', team: 'blue' });
  game.state = 'over';
  game.overT = 60;
  net.onPeerLeave('blue');
  expect(lobby.players.get('other').team).toBe('red');
  app.session.returnFromResults();
  expect(game.state).toBe('lobby');
  const send = vi.spyOn(net, 'send');
  app.session.hostStart();
  expect(scores.get('local').team).toBe('red');
  expect(scores.get('other').team).toBe('blue');
  expect(send.mock.calls.find(([kind]) => kind === 'lobby')?.[1].players).toEqual([
    { id: 'local', name: 'player', team: 'red' },
    { id: 'other', name: 'guest', team: 'blue' },
  ]);
  expect(send.mock.calls.findIndex(([kind]) => kind === 'lobby')).toBeLessThan(
    send.mock.calls.findIndex(([kind]) => kind === 'start'),
  );
});
