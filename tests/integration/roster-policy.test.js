// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { applicationFixture } from '../support/application.js';
let fixture;
afterEach(() => {
  fixture?.app.dispose();
  fixture = null;
});
it('transfers a migration follower score before broadcasting and retains the late-join map and broken prop report', () => {
  fixture = applicationFixture('mexico');
  const { app, net, game, lobby, scores, state } = fixture;
  net.id = 'host';
  net.isHost = true;
  net.code = 'ABCDE';
  game.state = 'play';
  game.mode = 'ffa';
  lobby.isPublic = false;
  lobby.players.set('old', { name: 'before' });
  lobby.order = ['host', 'old'];
  lobby.migrationPeers = new Set(['old']);
  scores.set('old', { name: 'before', kills: 4, deaths: 2 });
  const previous = app.multiplayer.addRemote('old', 'before');
  const retired = vi.spyOn(previous, 'dispose');
  vi.spyOn(app.match, 'farthestSpawnIndex').mockReturnValue(3);
  state.level.breakables[0].alive = false;
  const events = [];
  vi.spyOn(net, 'send').mockImplementation((kind, data) => events.push([kind, data]));
  vi.spyOn(net, 'sendTo').mockImplementation((...args) => events.push(['direct', ...args]));
  vi.spyOn(app.match, 'sendScores').mockImplementation(() => events.push(['scores']));
  vi.spyOn(fixture.hud, 'kill').mockImplementation((...args) => events.push(['feed', ...args]));
  net.onPeerJoin('new', { name: 'a very long paper name', prev: 'old' });
  expect(retired).toHaveBeenCalledOnce();
  expect(fixture.remote.has('old')).toBe(false);
  expect(scores.get('new')).toEqual({ name: 'before', kills: 4, deaths: 2 });
  expect(scores.has('old')).toBe(false);
  expect(lobby.order).toEqual(['host']);
  expect(events).toEqual([
    [
      'lobby',
      {
        players: [{ id: 'new', name: 'a very long pa' }],
        hostId: 'host',
        isPublic: false,
        map: 'mexico',
        shown: 'ABCDE',
        duration: 600,
      },
    ],
    [
      'direct',
      'new',
      'start',
      {
        late: true,
        spawn: 3,
        map: 'mexico',
        broken: [0],
        duration: 600,
        clock: { left: 600, on: false },
      },
    ],
    ['scores'],
    ['feed', 'a very long pa joined', 0],
  ]);
});
it('reconciles a received roster before score refresh and does not retain a removed replica', () => {
  fixture = applicationFixture();
  const { app, net, lobby, scores, game, remote } = fixture;
  net.id = 'guest';
  net.isHost = false;
  net.authorityId = 'host';
  net.code = 'ABCDE-2';
  game.mode = 'ffa';
  game.state = 'play';
  const old = app.multiplayer.addRemote('old', 'before');
  const retired = vi.spyOn(old, 'dispose');
  scores.set('old', { name: 'before', kills: 1, deaths: 0 });
  const refresh = vi.spyOn(app.match, 'refreshScoreHud').mockImplementation(() => {
    expect(remote.has('old')).toBe(false);
    expect(lobby.order).toEqual(['host', 'guest']);
    expect(scores.get('host')).toEqual({ name: 'ink', kills: 0, deaths: 0 });
  });
  net._emit(
    'lobby',
    {
      hostId: 'host',
      isPublic: true,
      map: 'mexico',
      shown: 'ABCDE',
      players: [
        { id: 'host', name: 'ink' },
        { id: 'guest', name: 'paper' },
      ],
    },
    'host',
  );
  expect(retired).toHaveBeenCalledOnce();
  expect(refresh).toHaveBeenCalledOnce();
  expect(scores.has('old')).toBe(false);
  expect(remote.size).toBe(1);
  expect(lobby).toMatchObject({ code: 'ABCDE-2', shown: 'ABCDE', map: 'mexico', isPublic: true });
});
