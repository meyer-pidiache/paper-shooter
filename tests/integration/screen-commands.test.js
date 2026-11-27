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
  vi.spyOn(fixture.net, 'listLobbies').mockResolvedValue({ rows: [], incomplete: false });
  return fixture;
}
it('persists menu map selection and requests checkpoint start without bubbling a second command', () => {
  const { app, state, values } = setup();
  const begin = vi.spyOn(app.session, 'begin');
  const checkpoint = vi.spyOn(app.session, 'beginAtWave');
  state.checkpoint = 10;
  app.screens.showStart();
  document.querySelector('[data-map="mexico"] i').click();
  expect(state.mapKey).toBe('mexico');
  expect(values.get('paper_map')).toBe('mexico');
  expect(begin).not.toHaveBeenCalled();
  document.querySelector('[data-cp="10"]').click();
  expect(checkpoint).toHaveBeenCalledOnce();
  expect(checkpoint).toHaveBeenCalledWith(10);
});
it('normalizes Enter joins, keeps Back enabled while locked and clears rejoin state', () => {
  const { app, lobby, state } = setup();
  const join = vi.spyOn(app.multiplayer, 'joinLobby').mockImplementation(() => {});
  lobby.rejoinCode = 'OLD01';
  document.querySelector('#onlineBtn').click();
  const code = document.querySelector('#codeBox');
  code.value = ' abcd ';
  code.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(join).toHaveBeenLastCalledWith('ABCD');
  expect(document.querySelector('#joinBtn').disabled).toBe(true);
  expect(document.querySelector('#backBtn').disabled).toBe(false);
  app.screens.unlockButtons();
  document.querySelector('#rejoinBtn').click();
  expect(join).toHaveBeenLastCalledWith('OLD01');
  expect(lobby.rejoinCode).toBeNull();
  const cancel = vi.spyOn(app.multiplayer, 'cancelPending');
  document.querySelector('#backBtn').click();
  expect(cancel).toHaveBeenCalledOnce();
  expect(state.screen).toBe('main');
  expect(lobby.status).toBe('');
});
it('keeps lobby map authority and asks the host to start for a follower', () => {
  const { app, net, lobby, game } = setup();
  game.state = 'lobby';
  lobby.map = 'district';
  net.isHost = false;
  const send = vi.spyOn(net, 'send').mockImplementation(() => {});
  const broadcast = vi.spyOn(app.multiplayer, 'broadcastLobby');
  const start = vi.spyOn(app.session, 'hostStart').mockImplementation(() => {});
  app.screens.renderLobby();
  document.querySelector('[data-map="mexico"]').click();
  expect(lobby.map).toBe('district');
  expect(broadcast).not.toHaveBeenCalled();
  document.querySelector('#startBtn').click();
  expect(send).toHaveBeenLastCalledWith('startreq', {});
  expect(lobby.status).toBe('asking the host to start…');
  net.isHost = true;
  app.screens.renderLobby();
  document.querySelector('[data-map="mexico"]').click();
  expect(lobby.map).toBe('mexico');
  expect(broadcast).toHaveBeenCalledOnce();
  document.querySelector('#startBtn').click();
  expect(start).toHaveBeenCalledOnce();
});

function soloLobby() {
  const fixture = setup();
  const { app, net, lobby, scores } = fixture;
  net.id = 'local';
  net.isHost = true;
  lobby.hostId = net.id;
  lobby.players.set(net.id, { name: 'player', team: 'red' });
  lobby.teamBank = { red: 4, blue: 7 };
  scores.set(net.id, { name: 'player', kills: 8, deaths: 1, team: 'red' });
  app.session.enterLobby();
  return fixture;
}

it.each([
  ['host button', () => document.querySelector('#startBtn').click()],
  ['stale guest request', (net) => net._emit('startreq', {}, 'departed-guest')],
])('blocks a solo Teams start from the %s without resetting the match', (_source, start) => {
  const { net, game, lobby, scores } = soloLobby();
  const mode = document.querySelector('#matchMode');
  mode.value = 'teams';
  mode.dispatchEvent(new Event('change'));
  const send = vi.spyOn(net, 'send');
  const hint = [...document.querySelectorAll('#online .hint')].at(-1).textContent;
  start(net);

  expect.soft(game.state).toBe('lobby');
  expect.soft(net.inMatch).toBe(false);
  expect.soft(lobby.teamBank).toEqual({ red: 4, blue: 7 });
  expect
    .soft([...scores])
    .toEqual([['local', { name: 'player', kills: 8, deaths: 1, team: 'red' }]]);
  expect.soft(send.mock.calls.map(([kind]) => kind)).not.toContain('start');
  expect.soft(send.mock.calls.map(([kind]) => kind)).not.toContain('score');
  expect(hint).toBe('Teams needs at least one player on each team');
});

it('still starts a solo host in Free for all', () => {
  const { net, game, lobby, scores } = soloLobby();
  const send = vi.spyOn(net, 'send');
  document.querySelector('#startBtn').click();

  expect(game.state).toBe('play');
  expect(net.inMatch).toBe(true);
  expect(lobby.teamBank).toEqual({ red: 0, blue: 0 });
  expect([...scores]).toEqual([['local', { name: 'player', kills: 0, deaths: 0 }]]);
  expect(send.mock.calls.filter(([kind]) => kind === 'start')).toEqual([
    ['start', expect.objectContaining({ spawns: { local: expect.any(Number) } })],
  ]);
});
