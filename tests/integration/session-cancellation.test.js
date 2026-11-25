// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applicationFixture } from '../support/application.js';

let fixture;
afterEach(() => {
  fixture?.app.dispose();
  fixture = null;
  vi.clearAllTimers();
  vi.useRealTimers();
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('session work cannot outlive leave, replacement or application disposal', () => {
  it('retires the delayed match prompt on disposal', async () => {
    vi.useFakeTimers();
    fixture = applicationFixture();
    fixture.app.session.startMatch(false);
    fixture.input.usingGamepad = false;
    fixture.app.dispose();
    const render = vi.spyOn(fixture.hud, 'showScreen');
    await vi.advanceTimersByTimeAsync(300);
    expect(render).not.toHaveBeenCalled();
  });
  it('does not show an earlier match prompt over a new solo run', async () => {
    vi.useFakeTimers();
    fixture = applicationFixture();
    fixture.app.session.startMatch(false);
    fixture.app.session.toMainMenu();
    fixture.app.session.begin();
    fixture.input.usingGamepad = false;
    await vi.advanceTimersByTimeAsync(300);
    expect(fixture.game).toMatchObject({ state: 'play', mode: 'solo', menu: false });
  });
  it('ignores a host completion after leaving the online screen', async () => {
    fixture = applicationFixture();
    const { app, net, game } = fixture;
    const pending = deferred();
    vi.spyOn(net, 'host').mockReturnValue(pending.promise);
    const opening = app.multiplayer.createLobby(false);
    app.multiplayer.leaveOnline('cancelled');
    pending.resolve('ABCDE');
    await opening;
    expect(game.state).toBe('start');
    expect(fixture.state.screen).toBe('online');
    expect(fixture.lobby.status).toBe('cancelled');
  });
  it('does not publish a failed join after application disposal', async () => {
    fixture = applicationFixture();
    const { app, net, lobby, hud } = fixture;
    const pending = deferred();
    vi.spyOn(net, 'join').mockReturnValue(pending.promise);
    const joining = app.multiplayer.joinLobby('ABCDE');
    app.dispose();
    lobby.status = 'disposed';
    const render = vi.spyOn(hud, 'showScreen');
    pending.reject(new Error('signalling timed out'));
    await joining;
    expect(lobby.status).toBe('disposed');
    expect(render).not.toHaveBeenCalled();
  });
  it('keeps an older quick-play result and status from replacing a newer lobby', async () => {
    fixture = applicationFixture();
    const { app, net, lobby } = fixture;
    const pending = deferred();
    let status;
    vi.spyOn(net, 'quickJoin').mockImplementation((meta, publish) => {
      status = publish;
      return pending.promise;
    });
    vi.spyOn(net, 'join').mockResolvedValue('NEWER');
    const older = app.multiplayer.quickPlay();
    await app.multiplayer.joinLobby('NEWER');
    status('outdated progress');
    pending.reject(new Error('outdated failure'));
    await older;
    expect(lobby.status).toBe('');
    expect(fixture.game.state).toBe('lobby');
  });
  it('cancels pending creation when the online Back button is used', async () => {
    fixture = applicationFixture();
    const { app, net, game, state } = fixture;
    const pending = deferred();
    vi.spyOn(net, 'host').mockReturnValue(pending.promise);
    // Suppress background discovery so this scenario covers the connection transaction only.
    vi.spyOn(net, 'listLobbies').mockResolvedValue({ rows: [], incomplete: false });
    document.querySelector('#onlineBtn').click();
    const opening = app.multiplayer.createLobby(false);
    document.querySelector('#backBtn').click();
    pending.resolve('ABCDE');
    await opening;
    expect(game.state).toBe('start');
    expect(state.screen).toBe('main');
  });
  it('cancels a follower migration backoff when the user leaves', async () => {
    vi.useFakeTimers();
    fixture = applicationFixture();
    const { app, net, lobby, game } = fixture;
    net.id = 'me';
    lobby.hostId = 'old';
    lobby.code = 'ABCDE';
    lobby.order = ['old', 'successor', 'me'];
    for (const id of lobby.order) lobby.players.set(id, { name: id });
    game.mode = 'ffa';
    game.state = 'play';
    const join = vi.spyOn(net, 'join').mockResolvedValue('ABCDE-1');
    const migration = app.multiplayer.migrateHost();
    app.multiplayer.leaveOnline('done');
    await vi.advanceTimersByTimeAsync(1500);
    await migration;
    expect(join).not.toHaveBeenCalled();
    expect(game.state).toBe('start');
  });
  it('does not retry hosting after disposal during migration backoff', async () => {
    vi.useFakeTimers();
    fixture = applicationFixture();
    const { app, net, lobby } = fixture;
    net.id = 'me';
    lobby.hostId = 'old';
    lobby.code = 'ABCDE';
    lobby.order = ['old', 'me'];
    for (const id of lobby.order) lobby.players.set(id, { name: id });
    const host = vi.spyOn(net, 'host').mockRejectedValue(new Error('unavailable'));
    const migration = app.multiplayer.migrateHost();
    await Promise.resolve();
    await Promise.resolve();
    app.dispose();
    const render = vi.spyOn(fixture.hud, 'showScreen');
    await vi.advanceTimersByTimeAsync(2000);
    await migration;
    expect(host).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
  });
});
