// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { applicationFixture } from '../support/application.js';
import baseline from '../fixtures/screens-baseline.json';

let fixture;
afterEach(() => {
  fixture?.app.dispose();
  fixture = null;
});
it('preserves menu, browsing, host/follower lobby, pause, death and prompt presentation', async () => {
  fixture = applicationFixture();
  const { app, hud, state, net, lobby, game, scores, values } = fixture;
  const frames = [];
  const capture = (label) =>
    frames.push({
      label,
      html: hud.el.panel.innerHTML,
      screen: state.screen,
      phase: game.state,
      best: state.best,
    });
  capture('initial');
  state.best = 100;
  state.checkpoint = 15;
  state.mapKey = 'mexico';
  state.settings.sens = 150;
  state.settings.invert = true;
  state.musicWanted = true;
  app.screens.showStart();
  capture('main-progress');
  let resolve;
  vi.spyOn(net, 'listLobbies').mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  state.myName = '<paper>';
  lobby.status = '<status>';
  lobby.rejoinCode = 'REJ01';
  document.querySelector('#onlineBtn').click();
  document.querySelector('#browseFlow').open = true;
  await vi.waitFor(() =>
    expect(document.querySelector('#lobbyRows').textContent).toContain(
      'Searching for public lobbies',
    ),
  );
  capture('online-busy');
  resolve({
    incomplete: false,
    rows: [
      { code: 'FULL1', hostName: '<full>', players: 10, max: 10, inMatch: true, full: true },
      { code: 'OPEN1', hostName: '', players: 1, max: 10, inMatch: false, full: false },
    ],
  });
  await Promise.resolve();
  await Promise.resolve();
  capture('online-list');
  net.id = 'host';
  net.isHost = true;
  net.aliasCode = 'ABCDE-2';
  net.code = 'ABCDE-3';
  lobby.hostId = 'host';
  lobby.map = 'mexico';
  lobby.players.set('host', { name: '<host>' });
  lobby.players.set('guest', { name: '<guest>' });
  game.state = 'lobby';
  app.screens.renderLobby();
  capture('host-lobby');
  net.isHost = false;
  net.id = 'guest';
  lobby.shown = 'SHOWN-3';
  lobby.map = null;
  app.screens.renderLobby();
  capture('follower-lobby');
  scores.set('host', { name: '<host>', kills: 7, deaths: 1 });
  scores.set('guest', { name: '<guest>', kills: 2, deaths: 3 });
  game.mode = 'ffa';
  game.state = 'play';
  app.screens.showPause();
  capture('online-pause');
  game.mode = 'solo';
  game.wave = 3;
  game.score = 740;
  app.screens.showPause();
  capture('solo-pause');
  game.state = 'dead';
  game.wave = 1;
  game.score = 1000;
  game.kills = 7;
  app.screens.showDead();
  capture('new-best');
  expect(values.get('paper_best')).toBe('1000');
  game.wave = 2;
  app.screens.showDead();
  capture('existing-best');
  app.screens.showClickToPlay();
  capture('click-to-play');
  const result = {
    frames: frames.length,
    digest: createHash('sha256').update(JSON.stringify(frames)).digest('hex'),
  };
  if (process.env.RECORD_SCREENS_BASELINE === '1')
    writeFileSync(
      'tests/fixtures/screens-baseline.json',
      JSON.stringify({ source: 'Issue #5', ...result }, null, 2) + '\n',
    );
  else {
    if (result.digest !== baseline.digest) {
      mkdirSync('reports', { recursive: true });
      writeFileSync('reports/screens-trace.json', JSON.stringify({ result, frames }));
    }
    const expected = { ...baseline };
    delete expected.source;
    expect(result).toEqual(expected);
  }
});
