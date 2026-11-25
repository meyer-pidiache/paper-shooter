import { expect, it, vi } from 'vitest';
import { ScreenController } from '../../src/application/screens.js';
import { RunProgress } from '../../src/application/run-progress.js';
import type { ScreenPorts } from '../../src/application/screen-contracts.js';
import type { ScreenEvents } from '../../src/presentation/screen-bindings.js';
import type { MapKey } from '../../src/domain/maps.js';

it('runs navigation, read models, browse and progress against ports without a browser or game runtime', async () => {
  const navigation: ScreenPorts['navigation'] = { screen: 'main' };
  const profile: { mapKey: MapKey; myName: string } = {
    mapKey: 'district',
    myName: '<paper>',
  };
  const game: ScreenPorts['game'] = { state: 'dead', wave: 2, score: 40, kills: 3 };
  const write = vi.fn();
  const records = new RunProgress({ best: 20, checkpoint: 5 }, { write });
  let events: ScreenEvents | undefined;
  const view: ScreenPorts['view'] = {
    settingsHTML: () => '',
    confirm: () => 'Enter',
    show: vi.fn(),
    gameplay: vi.fn(),
    bind: (_mode, commands) => {
      events = commands;
    },
    status: vi.fn(),
    rows: vi.fn(),
    unlockButtons: vi.fn(),
  };
  const listLobbies = vi.fn(async () => ({ rows: [], incomplete: false }));
  const screens = new ScreenController({
    navigation,
    profile,
    game,
    records,
    view,
    lobby: { map: null, hostId: null, isPublic: true, status: '' },
    transport: {
      id: null,
      code: null,
      aliasCode: null,
      isHost: false,
      active: false,
      maxPlayers: 10,
      listLobbies,
      send: vi.fn(),
    },
    online: () => false,
    selectMap: (map) => {
      profile.mapKey = map;
    },
    actions: {
      cancelPending: vi.fn(),
      lobbyRows: () => [],
      friendlyError: () => 'lookup failed',
      quickPlay: vi.fn(),
      createLobby: vi.fn(),
      setStatus: vi.fn(),
      joinLobby: vi.fn(),
      broadcastLobby: vi.fn(),
      hostStart: vi.fn(),
      leaveOnline: vi.fn(),
      beginAtWave: vi.fn(),
      begin: vi.fn(),
      sortedScores: () => [],
      toMainMenu: vi.fn(),
    },
  });
  screens.showStart();
  events?.selectMap('mexico');
  expect(profile.mapKey).toBe('mexico');
  events?.online();
  expect(navigation.screen).toBe('online');
  expect(view.show).toHaveBeenLastCalledWith(expect.stringContaining('value="&lt;paper&gt;"'));
  await screens.refreshLobbies();
  expect(listLobbies).toHaveBeenCalledWith({ name: '<paper>' });
  expect(view.rows).toHaveBeenLastCalledWith(expect.stringContaining('No public lobbies found.'));
  screens.showDead();
  expect(write).toHaveBeenCalledWith('best', '40');
  expect(game.state).toBe('dead');
  expect(view.show).toHaveBeenLastCalledWith(expect.stringContaining('NEW BEST'));
  screens.showDead();
  expect(write).toHaveBeenCalledOnce();
  screens.dispose();
});
