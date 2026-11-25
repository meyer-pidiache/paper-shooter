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
