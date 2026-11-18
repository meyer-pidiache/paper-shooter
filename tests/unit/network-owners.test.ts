import { expect, it, vi } from 'vitest';
import { IdlePlayers, type IdlePorts } from '../../src/application/idle-players.js';
import { MatchClock, type MatchClockPorts } from '../../src/application/match-clock.js';
function idleFixture() {
  let seconds = 131;
  const ports: IdlePorts = {
    transport: { active: true, isHost: true, code: 'ABCDE-2' },
    opponents: () => peers,
    inMatch: () => true,
    idleSeconds: () => seconds,
    now: () => 180001,
    warn: vi.fn(),
    kick: vi.fn(),
    leave: vi.fn(),
    rejoin: vi.fn(),
  };
  const peers = new Map([['guest', { idle: true, idleSince: 1 }]]);
  return {
    ports,
    peers,
    owner: new IdlePlayers(ports),
    idle: (value: number) => {
      seconds = value;
    },
  };
}
it('retains the host warning across guest activity and throttles remote kick requests', () => {
  const { owner, ports, peers, idle } = idleFixture();
  owner.update(1);
  expect(ports.warn).toHaveBeenCalledOnce();
  expect(ports.kick).toHaveBeenCalledWith('guest');
  owner.update(0.4);
  expect(ports.kick).toHaveBeenCalledOnce();
  peers.get('guest')!.idle = false;
  owner.update(0.6);
  peers.get('guest')!.idle = true;
  owner.update(1);
  expect(ports.warn).toHaveBeenCalledOnce();
  idle(130);
  owner.update(1);
  idle(131);
  owner.update(1);
  expect(ports.warn).toHaveBeenCalledTimes(2);
});
it('captures a kick rejoin code before leave invalidates the transport', () => {
  const { owner, ports } = idleFixture();
  const transport = { active: true, isHost: false, code: 'ABCDE-7', aliasCode: 'PAPER-8' };
  ports.transport = transport;
  ports.leave = vi.fn(() => {
    transport.code = '';
    transport.aliasCode = '';
  });
  owner.kicked('closed');
  expect(ports.leave).toHaveBeenCalledWith('closed');
  expect(ports.rejoin).toHaveBeenCalledWith('PAPER');
});
function clockFixture() {
  const events: unknown[] = [];
  const game: { clockStarted: boolean; over: unknown; matchT: number } = {
    clockStarted: false,
    over: null,
    matchT: 0,
  };
  const now = vi.fn(() => 0);
  const ports: MatchClockPorts = {
    now,
    state: { matchLeft: 1, clockRunning: false, clockT: 0 },
    game,
    transport: { isHost: true, id: 'me', send: (...args) => events.push(args) },
    inMatch: () => true,
    opponentCount: () => 0,
    localName: () => 'paper',
    sortedScores: () => [],
    timer: (value) => events.push(['timer', value]),
    end: (winner) => {
      events.push(['result', winner]);
      game.over = winner;
    },
  };
  return { ports, events, now, owner: new MatchClock(ports) };
}
it('owns clock reporting cadence and sends the fallback host result after the final timer projection', () => {
  const { ports, owner, events } = clockFixture();
  owner.update(0.5);
  expect(events).toEqual([
    ['clock', { left: 1, on: false }],
    ['timer', 'clock starts when someone joins'],
  ]);
  ports.opponentCount = () => 1;
  owner.update(0.5);
  expect(ports.state.matchLeft).toBe(0.5);
  events.length = 0;
  owner.update(0.5);
  expect(events).toEqual([
    ['timer', 'FINAL SECONDS · 0:00'],
    ['end', { id: 'me', name: 'paper' }],
    ['result', { id: 'me', name: 'paper' }],
  ]);
  expect(ports.game.matchT).toBe(1);
  owner.update(3);
  expect(events).toHaveLength(3);
});
it('applies received clocks only on followers and gives no expiry authority to a follower', () => {
  const { ports, owner, now } = clockFixture();
  owner.receive({ left: 60, on: true });
  expect(ports.state.matchLeft).toBe(1);
  ports.transport = { isHost: false, id: 'guest', send: vi.fn() };
  owner.receive({ left: 0.2, on: true });
  now.mockReturnValue(1000);
  owner.update(1);
  expect(ports.state.matchLeft).toBe(0);
  expect(ports.transport.send).not.toHaveBeenCalled();
  expect(ports.game.over).toBeNull();
});
it('counts only time after the latest snapshot during a delayed follower frame', () => {
  const { ports, owner, now } = clockFixture();
  ports.transport = { isHost: false, id: 'guest', send: vi.fn() };
  now.mockReturnValue(8000);
  owner.receive({ left: 592, on: true });
  now.mockReturnValue(9750);
  owner.receive({ left: 590, on: true });

  now.mockReturnValue(10060);
  owner.update(10, 10000);
  expect(ports.state.matchLeft).toBe(589.75);

  owner.update(1, 11000);
  expect(ports.state.matchLeft).toBe(588.75);
});

it('retains the observation when the frame timestamp precedes its receipt', () => {
  const { ports, owner, now } = clockFixture();
  ports.transport = { isHost: false, id: 'guest', send: vi.fn() };
  now.mockReturnValue(10050);
  owner.receive({ left: 10, on: true });

  owner.update(10, 10000);
  expect(ports.state.matchLeft).toBe(10);
  owner.update(0.1, 10100);
  expect(ports.state.matchLeft).toBeCloseTo(9.95);
});

it('waits for a hosting identity before claiming an expired clock during recovery', () => {
  const { ports, owner, events } = clockFixture();
  ports.transport = { ...ports.transport, id: null };
  ports.opponentCount = () => 1;
  ports.state.matchLeft = 0;
  ports.sortedScores = () => [['previous-player', { name: 'paper', kills: 3, deaths: 0 }]];
  owner.update(0.1);
  expect(ports.game.over).toBeNull();
  expect(events).not.toContainEqual(['end', { id: 'previous-player', name: 'paper' }]);
  ports.transport = { ...ports.transport, id: 'new-host' };
  ports.sortedScores = () => [['new-host', { name: 'paper', kills: 3, deaths: 0 }]];
  owner.update(0);
  expect(events.slice(-2)).toEqual([
    ['end', { id: 'new-host', name: 'paper' }],
    ['result', { id: 'new-host', name: 'paper' }],
  ]);
});
