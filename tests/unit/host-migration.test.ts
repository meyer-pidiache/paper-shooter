import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostMigration } from '../../src/application/host-migration.js';
import { SessionTasks } from '../../src/application/session-tasks.js';
import type { LobbyConnectionPorts } from '../../src/application/lobby-contracts.js';
afterEach(() => vi.useRealTimers());
function fixture(successor = true) {
  const events: string[] = [];
  const transport = {
    id: 'me' as string | null,
    code: 'ABCDE',
    isPublic: true,
    accepting: false,
    onAlias: null as (() => void) | null,
    host: vi.fn(async () => {
      transport.id = 'new-host';
    }),
    join: vi.fn(async () => {}),
    quickJoin: vi.fn(async () => {}),
    leave: vi.fn(),
    claimAlias: vi.fn(() => {
      events.push('alias');
    }),
  };
  const ports: LobbyConnectionPorts = {
    transport,
    lobby: {
      players: new Map([
        ['old', { name: 'old' }],
        ['me', { name: 'mine' }],
        ['next', { name: 'next' }],
      ]),
      hostId: 'old',
      isPublic: true,
      status: '',
      code: 'ABCDE',
      map: 'district',
      order: successor ? ['old', 'me', 'next'] : ['old', 'next', 'me'],
    },
    scores: new Map([['me', { name: 'mine', kills: 7, deaths: 2 }]]),
    local: { myName: 'mine', mapKey: 'district', playerColor: 'green' },
    removeRemote: vi.fn((id) => {
      ports.lobby.players.delete(id);
      ports.scores.delete(id);
    }),
    remoteIds: () => [],
    inMatch: () => true,
    broadcastLobby: vi.fn(() => {
      events.push('broadcast');
    }),
    session: {
      enterLobby: vi.fn(),
      returnOnline: vi.fn(),
      takeClockAuthority: vi.fn(() => {
        events.push('clock');
      }),
      recoverHost: vi.fn(() => {
        events.push('recover');
      }),
      recoverFollower: vi.fn(),
    },
    presentation: { status: vi.fn(), unlockButtons: vi.fn(), message: vi.fn(), feed: vi.fn() },
  };
  const tasks = new SessionTasks();
  const leave = vi.fn(() => tasks.cancel());
  return {
    ports,
    tasks,
    transport,
    leave,
    events,
    migration: new HostMigration(tasks, ports, leave),
  };
}
describe('host recovery policy', () => {
  it('retries the successor once, preserves score/roster and orders clock, alias and presentation', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.transport.host.mockRejectedValueOnce(new Error('busy'));
    const running = f.migration.run();
    await f.migration.run(); // Duplicate disconnect reports do not start competing migrations.
    expect(f.transport.host).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800);
    await running;
    expect(f.transport.host).toHaveBeenCalledTimes(2);
    expect(f.ports.scores.get('new-host')).toMatchObject({ kills: 7, deaths: 2 });
    expect(f.ports.scores.has('me')).toBe(false);
    expect(f.ports.lobby.players.get('new-host')).toEqual({ name: 'mine', color: 'green' });
    expect(f.ports.lobby.order).toEqual(['new-host', 'next']);
    expect(f.events).toEqual(['clock', 'alias', 'recover', 'broadcast']);
    f.transport.onAlias?.();
    expect(f.ports.presentation.feed).toHaveBeenCalledTimes(1);
    f.tasks.cancel();
    f.transport.onAlias?.();
    expect(f.ports.presentation.feed).toHaveBeenCalledTimes(1);
  });
  it('leaves after two failed successor attempts without changing authority', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.transport.host.mockRejectedValue(new Error('unreachable'));
    const running = f.migration.run();
    await vi.advanceTimersByTimeAsync(1700);
    await running;
    expect(f.transport.host).toHaveBeenCalledTimes(2);
    expect(f.leave).toHaveBeenCalledWith('could not take over the lobby');
    expect(f.ports.session.takeClockAuthority).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds follower retries and exits without publishing a recovered lobby', async () => {
    vi.useFakeTimers();
    const f = fixture(false);
    f.transport.join.mockRejectedValue(new Error('not ready'));
    const running = f.migration.run();
    await vi.advanceTimersByTimeAsync(24000);
    await running;
    expect(f.transport.join).toHaveBeenCalledWith('ABCDE-1', {
      name: 'mine',
      color: 'green',
      prev: 'me',
    });
    expect(f.leave).toHaveBeenCalledWith('lost the match when the host left');
    expect(f.ports.session.recoverFollower).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not attempt an election with an empty surviving roster', async () => {
    const f = fixture();
    f.ports.lobby.order = ['old'];
    await f.migration.run();
    expect(f.leave).toHaveBeenCalledWith('the host left the lobby');
    expect(f.transport.host).not.toHaveBeenCalled();
  });
});
it('captures successor identity and score before retiring an endpoint that clears its ids', async () => {
  const f = fixture();
  f.transport.leave.mockImplementation(() => {
    f.transport.id = null;
    f.transport.code = '';
  });
  await f.migration.run();
  expect(f.transport.leave).toHaveBeenCalledOnce();
  expect(f.transport.host).toHaveBeenCalledWith({ isPublic: true, code: 'ABCDE-1' });
  expect(f.ports.scores.get('new-host')).toEqual({ name: 'mine', kills: 7, deaths: 2 });
  expect(f.ports.session.recoverHost).toHaveBeenCalledWith(true);
});
it('retires a follower endpoint before backoff while retaining its previous identity for rejoin', async () => {
  vi.useFakeTimers();
  const f = fixture(false);
  f.transport.leave.mockImplementation(() => {
    f.transport.id = null;
    f.transport.code = '';
  });
  const running = f.migration.run();
  expect(f.transport.leave).toHaveBeenCalledOnce();
  expect(f.transport.join).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1200);
  await running;
  expect(f.transport.join).toHaveBeenCalledWith('ABCDE-1', {
    name: 'mine',
    color: 'green',
    prev: 'me',
  });
  expect(f.ports.session.recoverFollower).toHaveBeenCalledWith(true);
});
