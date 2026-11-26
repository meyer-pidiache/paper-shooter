// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { applicationFixture } from '../support/application.js';
let fixture;
afterEach(() => {
  fixture?.app.dispose();
  fixture = null;
  vi.clearAllTimers();
  vi.useRealTimers();
});
function setup(host = true, phase = 'play') {
  vi.useFakeTimers();
  fixture = applicationFixture();
  const { net, game, input, lobby, scores } = fixture;
  net.id = host ? 'local' : 'follower';
  net.isHost = host;
  net.connected = true;
  net.peer = { destroy() {} };
  net.code = 'ABCDE-2';
  game.mode = 'ffa';
  game.state = phase;
  lobby.players.set(net.id, { name: 'player' });
  scores.set(net.id, { name: 'player', kills: 0, deaths: 0 });
  const idle = vi.spyOn(input, 'idleSeconds', 'get').mockReturnValue(0);
  const send = vi.spyOn(net, 'send').mockImplementation(() => {});
  const broadcast = vi.spyOn(net, 'broadcast').mockImplementation(() => {});
  const directed = vi.spyOn(net, 'sendTo').mockImplementation(() => {});
  return { ...fixture, idle, send, broadcast, directed };
}
it('warns once at the idle boundary and rearms only after activity', () => {
  const { app, idle, hud, audio } = setup(false);
  const message = vi.spyOn(hud, 'message'),
    sound = vi.spyOn(audio, 'empty');
  idle.mockReturnValue(130);
  app.multiplayer.idleUpdate(1);
  expect(message).not.toHaveBeenCalled();
  idle.mockReturnValue(130.01);
  app.multiplayer.idleUpdate(1);
  expect(message).toHaveBeenCalledOnce();
  app.multiplayer.idleUpdate(1);
  expect(message).toHaveBeenCalledOnce();
  idle.mockReturnValue(0);
  app.multiplayer.idleUpdate(1);
  idle.mockReturnValue(131);
  app.multiplayer.idleUpdate(1);
  expect(message).toHaveBeenCalledTimes(2);
  expect(sound).toHaveBeenCalledTimes(2);
});
it('retains an idle host while another player is active, then closes an entirely idle lobby', () => {
  const { app, idle, game, net, lobby } = setup(true, 'lobby');
  const remote = app.multiplayer.addRemote('other', 'paper');
  remote.idle = false;
  idle.mockReturnValue(301);
  app.multiplayer.idleUpdate(1);
  expect(net.active).toBe(true);
  remote.idle = true;
  app.multiplayer.idleUpdate(1);
  expect(net.active).toBe(false);
  expect(game.state).toBe('start');
  expect(lobby.status).toBe('lobby closed: everyone was idle');
  expect(lobby.rejoinCode).toBeNull();
});
it('returns kicked followers to the normalized rejoin code', () => {
  const { app, idle, lobby, state, net } = setup(false);
  idle.mockReturnValue(151);
  app.multiplayer.idleUpdate(1);
  expect(net.active).toBe(false);
  expect(lobby.rejoinCode).toBe('ABCDE');
  expect(lobby.status).toBe('kicked for inactivity');
  expect(state.screen).toBe('online');
  expect(document.querySelector('#rejoinBtn').textContent).toContain('ABCDE');
});
it('delays host-directed idle connection closure until the kick has been sent', () => {
  const { app, net, directed } = setup(true, 'lobby');
  const remote = app.multiplayer.addRemote('other', 'paper');
  remote.idle = true;
  remote.idleSince = 1;
  const close = vi.fn();
  net.conns.set('other', { close });
  vi.advanceTimersByTime(301000);
  app.multiplayer.idleUpdate(1);
  expect(directed).toHaveBeenCalledWith('other', 'kick', { reason: 'kicked for inactivity' });
  expect(close).not.toHaveBeenCalled();
  vi.advanceTimersByTime(499);
  expect(close).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(close).toHaveBeenCalledOnce();
});
it('starts the host clock when another player joins, keeps three-tick snapshots and flushes shots', () => {
  const { app, game, state, send, broadcast, shotQueue } = setup();
  app.multiplayer.netUpdate(0.5);
  expect(state.matchLeft).toBe(300);
  expect(send).toHaveBeenCalledWith('clock', { left: 300, on: false });
  app.multiplayer.addRemote('other', 'paper');
  app.multiplayer.netUpdate(0.5);
  expect(game.clockStarted).toBe(true);
  expect(state.matchLeft).toBe(299.5);
  shotQueue.push(1, 2, 3, 4, 5, 6);
  app.multiplayer.netUpdate(0.5);
  const snapshot = send.mock.calls.find(([type]) => type === 'ps');
  expect(snapshot[1]).toHaveLength(11);
  expect(snapshot[2]).toBe(true);
  expect(broadcast).toHaveBeenCalledWith('shots', { k: 'rifle', e: [1, 2, 3, 4, 5, 6] });
  expect(shotQueue).toHaveLength(0);
  expect(state.matchLeft).toBe(299);
});
it('follows the received clock flag without taking client result authority', () => {
  const { app, game, state, send } = setup(false);
  state.matchLeft = 1;
  state.clockRunning = false;
  app.multiplayer.netUpdate(0.5);
  expect(state.matchLeft).toBe(1);
  state.clockRunning = true;
  app.multiplayer.netUpdate(2);
  expect(state.matchLeft).toBe(0);
  expect(game.over).toBeNull();
  expect(send.mock.calls.some(([type]) => type === 'end')).toBe(false);
});
it.each(['teams', 'ffa'])(
  'handles a silent guest on a %s follower without assuming host authority',
  (mode) => {
    const { app, lobby, net, remote, scores, hud, send } = setup(false);
    const feed = vi.spyOn(hud, 'kill');
    lobby.mode = mode;
    lobby.teamBank = mode === 'teams' ? { red: 0, blue: 2 } : undefined;
    net.hostId = net.authorityId = lobby.hostId = 'host';
    const guest = { id: 'silent', name: 'silent', team: 'blue' };
    const replica = app.multiplayer.addRemote(guest.id, guest.name);
    replica.lastSeen = 1;
    lobby.players.set(guest.id, { name: guest.name, team: guest.team });
    lobby.order = [net.hostId, net.id, guest.id];
    const score = { name: guest.name, team: guest.team, kills: 4, deaths: 0 };
    scores.set(guest.id, score);
    vi.advanceTimersByTime(10000);
    app.multiplayer.netUpdate(0);
    if (mode === 'teams') {
      expect(remote.has(guest.id)).toBe(true);
      expect(lobby.players.get(guest.id)).toEqual({ name: guest.name, team: guest.team });
      expect(lobby.order).toEqual([net.hostId, net.id, guest.id]);
      expect(scores.get(guest.id)).toEqual(score);
      expect(lobby.teamBank).toEqual({ red: 0, blue: 2 });
      expect(feed).not.toHaveBeenCalled();
    } else {
      expect(remote.has(guest.id)).toBe(false);
      expect(lobby.players.has(guest.id)).toBe(false);
      expect(lobby.order).toEqual([net.hostId, net.id]);
      expect(scores.has(guest.id)).toBe(false);
      expect(lobby.teamBank).toBeUndefined();
      expect(feed).toHaveBeenCalledExactlyOnceWith('silent lost connection', 0);
    }
    expect(net.isHost).toBe(false);
    expect(send).not.toHaveBeenCalled();
  },
);
it('uses ranked scores for a host clock-expiry result and removes silent peers', () => {
  const { app, game, state, net, scores, send } = setup();
  scores.set('other', { name: 'winner', kills: 3, deaths: 1 });
  app.multiplayer.addRemote('other', 'winner');
  state.matchLeft = 0.1;
  app.multiplayer.netUpdate(0.2);
  expect(game.state).toBe('over');
  expect(send).toHaveBeenCalledWith('end', { id: 'other', name: 'winner', voteId: 1 });
  game.state = 'play';
  game.over = null;
  const remote = app.multiplayer.addRemote('silent', 'silent');
  remote.lastSeen = 1;
  const close = vi.fn();
  net.conns.set('silent', { close });
  vi.advanceTimersByTime(10000);
  app.multiplayer.netUpdate(0);
  expect(fixture.remote.has('silent')).toBe(false);
  expect(close).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith('leave', { id: 'silent' });
});
