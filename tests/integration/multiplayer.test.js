// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { applicationFixture } from '../support/application.js';
import { flushMessages, peerNetwork } from '../support/peer-network.js';
import { Net } from '../../src/network/peer-transport.js';
import {
  browserRejoinCredentials,
  RejoinCredentials,
} from '../../src/network/rejoin-credentials.js';

const fixtures = [];
afterEach(() => {
  for (const fixture of fixtures) fixture.app.dispose();
  fixtures.length = 0;
  localStorage.removeItem('paper_match_rejoins');
  vi.clearAllTimers();
  vi.useRealTimers();
});
function clients() {
  const { Peer } = peerNetwork();
  return (map = 'district', rejoinCredentials = new RejoinCredentials(null)) => {
    const net = new Net({
      PeerClass: Peer,
      options: async () => ({}),
      namespace: 'application-test-',
      rejoinCredentials,
    });
    const fixture = applicationFixture(map, { net });
    fixtures.push(fixture);
    return fixture;
  };
}

describe('complete multiplayer sessions through an in-memory signaling boundary', () => {
  it(
    'restores a reload through Quick Play in a full match and replaces the old connection for everyone',
    { timeout: 15_000 },
    async () => {
      vi.useFakeTimers();
      const make = clients();
      const host = make();
      const guest = make('district', browserRejoinCredentials());
      const observer = make();
      host.net.maxPlayers = 3;
      await host.app.multiplayer.createLobby(true);
      const code = host.net.code;
      await guest.app.multiplayer.joinLobby(code);
      await observer.app.multiplayer.joinLobby(code);
      host.app.session.hostStart();
      await flushMessages();

      const previous = guest.net.id;
      host.app.match.tallyDeath(host.net.id, previous);
      host.app.match.tallyDeath(previous, host.net.id);
      host.app.match.tallyDeath(previous, observer.net.id);
      await flushMessages();
      const score = { name: 'player', kills: 1, deaths: 2 };
      expect(guest.scores.get(previous)).toEqual(score);
      expect(observer.net.rejoinCredentials.get(code).token).not.toBe(
        guest.net.rejoinCredentials.get(code).token,
      );

      const reloaded = make('district', browserRejoinCredentials());
      await reloaded.app.multiplayer.quickPlay();
      await flushMessages();
      const id = reloaded.net.id;
      expect(reloaded.game.state).toBe('play');
      expect(host.net.peerIds).toEqual([observer.net.id, id]);
      expect(guest.net.active).toBe(false);
      for (const peer of [host, reloaded, observer]) {
        expect(peer.lobby.players.has(previous)).toBe(false);
        expect(peer.scores.has(previous)).toBe(false);
        expect(peer.scores.get(id)).toEqual(score);
        expect(peer.scores.size).toBe(3);
      }

      // An untrusted name or a previous peer ID cannot claim this live score.
      host.net.maxPlayers = 4;
      const other = make();
      await other.net.join(code, { name: 'player', prev: id });
      await flushMessages();
      expect(host.scores.get(other.net.id)).toEqual({ name: 'player', kills: 0, deaths: 0 });
      expect(host.scores.get(id)).toEqual(score);
    },
  );

  it(
    'restores scores after a timeout via public quick play and clears them at match end',
    { timeout: 15_000 },
    async () => {
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(1);
      const make = clients();
      const host = make();
      const credentials = new RejoinCredentials(null);
      const guest = make('district', credentials);
      await host.app.multiplayer.createLobby(true);
      const code = host.net.code;
      await guest.app.multiplayer.joinLobby(code);
      host.app.session.hostStart();
      await flushMessages();
      host.app.match.tallyDeath(host.net.id, guest.net.id);
      host.app.match.tallyDeath(guest.net.id, host.net.id);

      const timedOut = guest.net.id;
      guest.net.onDisconnect = null;
      await vi.advanceTimersByTimeAsync(9001);
      host.app.multiplayer.netUpdate(0);
      expect(host.net.peerIds).not.toContain(timedOut);
      expect(host.scores.has(timedOut)).toBe(false);

      const rejoined = make('district', credentials);
      const joining = rejoined.app.multiplayer.quickPlay();
      await vi.advanceTimersByTimeAsync(1600);
      await joining;
      await flushMessages();
      expect(rejoined.scores.get(rejoined.net.id)).toMatchObject({ kills: 1, deaths: 1 });

      const previous = rejoined.net.id;
      rejoined.net.leave();
      expect(host.scores.has(previous)).toBe(false);
      host.scores.get(host.net.id).kills = 20;
      host.app.match.checkWin();
      host.app.session.updateResults(20, () => {});
      expect(host.game.state).toBe('lobby');
      host.app.session.hostStart();
      await rejoined.app.multiplayer.joinLobby(code);
      await flushMessages();
      expect(rejoined.scores.get(rejoined.net.id)).toMatchObject({ kills: 0, deaths: 0 });
    },
  );

  // Two complete clients rebuild real maps during the scenario; covered CI runs exceeded 5s.
  // Keep the fake-clock/in-memory protocol checks bounded without changing other test limits.
  it(
    'shares the host map, snapshots, damage, pickups, broken props, clock and match result',
    { timeout: 10_000 },
    async () => {
      vi.useFakeTimers();
      const make = clients();
      const host = make('mexico'),
        guest = make();
      await host.app.multiplayer.createLobby(false);
      await guest.app.multiplayer.joinLobby(host.net.code);
      await flushMessages();
      expect(host.lobby.players.size).toBe(2);
      expect(guest.lobby.players.size).toBe(2);
      expect(host.lobby.duration).toBe(300);
      expect(guest.lobby.duration).toBe(300);
      const duration = host.hud.el.panel.querySelector('#matchDuration');
      duration.value = '900';
      duration.dispatchEvent(new Event('change'));
      await flushMessages();
      expect(guest.lobby.duration).toBe(900);
      expect(guest.hud.el.panel.textContent).toContain('Time limit · 15 minutes');
      expect(guest.hud.el.panel.querySelector('#matchDuration')).toBeNull();
      host.app.session.hostStart();
      await flushMessages();
      expect(host.state.matchLeft).toBe(900);
      expect(guest.state.matchLeft).toBe(900);
      expect(guest.game).toMatchObject({ mode: 'ffa', state: 'play' });
      expect(guest.state.level.key).toBe('mexico');
      host.player.shieldT = 0;
      guest.player.shieldT = 0;
      const hpBeforeInvalid = [host.player.hp, guest.player.hp];
      const guestConnection = guest.net.conns.get(host.net.id);
      for (const d of [null, { amount: -25 }, { amount: NaN }, { amount: 25, from: [0, 1] }]) {
        guestConnection.send({ t: 'pdmg', d });
        guestConnection.send({ t: 'pdmg', d, to: host.net.id, relay: true });
      }
      await flushMessages();
      expect([host.player.hp, guest.player.hp]).toEqual(hpBeforeInvalid);
      host.frame(0.016, 3);
      guest.frame(0.016, 3);
      await flushMessages();
      host.app.multiplayer.netUpdate(0.016);
      guest.app.multiplayer.netUpdate(0.016);
      expect(host.remote.get(guest.net.id).snapB).not.toBeNull();
      const previousSnapshot = host.remote.get(guest.net.id).snapB;
      guestConnection.send({ t: 'ps', d: [NaN], relay: true });
      await flushMessages();
      expect(host.remote.get(guest.net.id).snapB).toBe(previousSnapshot);
      const remote = host.remote.get(guest.net.id);
      guest.player.shieldT = 0;
      const hp = guest.player.hp;
      host.app.combat.hitPlayer(remote, 25, {
        part: 'torso',
        source: 'rifle',
        point: remote.center,
        dir: new Vector3(0, 0, -1),
        crit: false,
      });
      await flushMessages();
      expect(guest.player.hp).toBe(hp - 25);
      expect(guest.player.lastHitBy).toBe(host.net.id);
      const pickup = host.app.pickups.spawnPickup('ammo', new Vector3(999, 0, 999));
      await flushMessages();
      expect(guest.state.pickups.some((item) => item.id === pickup.id)).toBe(true);
      guest.net.send('take', { id: pickup.id });
      await flushMessages();
      expect(host.state.pickups.some((item) => item.id === pickup.id)).toBe(false);
      expect(guest.state.pickups.some((item) => item.id === pickup.id)).toBe(false);
      const prop = host.state.level.breakables[0];
      host.app.combat.breakProp(prop, new Vector3(1, 0, 0), true);
      await flushMessages();
      expect(guest.state.level.breakables[prop.id].alive).toBe(false);
      guest.app.session.pause();
      const menu = guest.hud.el.panel;
      const settings = menu.querySelector('#settingsShell');
      // jsdom does not implement the modal dialog methods.
      settings.open = true;
      settings.close = () => {
        settings.open = false;
      };
      settings.querySelector('#closeSettings').focus();
      const focused = document.activeElement;
      const pauseScores = menu.querySelector('#pauseScores');
      expect(pauseScores.querySelector('.me').textContent).toContain('0 K · 0 D');
      host.net.sendTo(guest.net.id, 'pdmg', { amount: 300, src: 'rifle' });
      await flushMessages();
      expect(guest.scores.get(host.net.id).kills).toBe(1);
      expect(pauseScores.querySelector('.me').textContent).toContain('0 K · 1 D');
      expect(settings.open).toBe(true);
      expect(document.activeElement).toBe(focused);
      expect(guest.game).toMatchObject({ state: 'dying', menu: true });
      host.app.multiplayer.netUpdate(1);
      await flushMessages();
      expect(guest.state.clockRunning).toBe(true);
      expect(guest.state.matchLeft).toBeGreaterThan(898);
      expect(guest.state.matchLeft).toBeLessThan(900);
      expect(guest.hud.el.timer.closest('.hud-tr')).toBeTruthy();
      const late = make();
      host.state.matchLeft = 9.5;
      await late.app.multiplayer.joinLobby(host.net.code);
      await flushMessages();
      expect(late.game.state).toBe('play');
      expect(late.state.matchLeft).toBeGreaterThan(9);
      expect(late.state.matchLeft).toBeLessThanOrEqual(9.5);
      expect(late.lobby.duration).toBe(900);
      late.app.multiplayer.netUpdate(0);
      expect(late.hud.el.timer.textContent).toBe('0:10');
      expect(late.hud.el.timer.parentElement).toBe(late.hud.root);
      expect(late.hud.el.timer.nextElementSibling).toBe(late.hud.el.screen);
      expect(late.hud.el.timer.classList.contains('urgent')).toBe(true);
      host.scores.get(host.net.id).kills = 20;
      host.app.match.checkWin();
      await flushMessages();
      expect(guest.game.state).toBe('over');
      expect(guest.game.over.id).toBe(host.net.id);
      expect(late.hud.el.timer.classList.contains('urgent')).toBe(false);
      expect(late.hud.el.timer.textContent).toBe('');
      expect(late.hud.el.timer.closest('.hud-tr')).toBeTruthy();
      host.app.session.screenClick();
      host.app.session.returnFromResults();
      expect(host.game.state).toBe('over');
      const hostChoice = host.hud.el.panel.querySelector('[data-vote-map="district"]');
      const guestChoice = guest.hud.el.panel.querySelector('[data-vote-map="mexico"]');
      hostChoice.click();
      guestChoice.click();
      // A ballot from an earlier match must have no effect.
      guest.net.send('mapvote', { voteId: 0, map: 'district' });
      await flushMessages();
      expect(hostChoice.getAttribute('aria-pressed')).toBe('true');
      expect(guestChoice.getAttribute('aria-pressed')).toBe('true');
      expect(hostChoice.textContent).toContain('1 vote');
      expect(guestChoice.textContent).toContain('1 vote');
      host.app.session.updateResults(5, () => {});
      host.app.session.screenClick();
      expect(host.game.state).toBe('over');
      host.app.session.updateResults(15, () => {});
      await flushMessages();
      expect(guest.game.state).toBe('over');
      guest.app.session.updateResults(5, () => {});
      expect(guest.game.state).toBe('lobby');
      expect(host.lobby).toMatchObject({ map: 'district', mapLocked: true });
      expect(guest.lobby).toMatchObject({ map: 'district', mapLocked: true });
      expect(host.hud.el.panel.textContent).toContain('Next map · PAPER DISTRICT');
      expect(host.hud.el.panel.querySelector('[data-map]')).toBeNull();
      await guest.app.multiplayer.leaveOnline('done');
      expect(guest.game.state).toBe('start');
    },
  );

  it(
    'transfers a running lobby to the remaining player and reclaims its public alias',
    { timeout: 10_000 },
    async () => {
      vi.useFakeTimers();
      const make = clients();
      const host = make(),
        guest = make();
      await host.app.multiplayer.createLobby(true);
      const code = host.net.code;
      const duration = host.hud.el.panel.querySelector('#matchDuration');
      duration.value = '900';
      duration.dispatchEvent(new Event('change'));
      await guest.app.multiplayer.joinLobby(code);
      await flushMessages();
      host.app.session.hostStart();
      await flushMessages();
      host.state.matchLeft = 730.5;
      host.app.multiplayer.netUpdate(0);
      await flushMessages();
      expect(guest.state.matchLeft).toBe(730.5);
      host.net.leave();
      await flushMessages();
      await vi.advanceTimersByTimeAsync(1600);
      await flushMessages();
      expect(guest.net.isHost).toBe(true);
      expect(guest.net.code).toBe(`${code}-1`);
      expect(guest.net.aliasCode).toBe(code);
      expect(guest.game.state).toBe('play');
      expect(guest.lobby.duration).toBe(900);
      expect(guest.state.matchLeft).toBe(730.5);
      expect(guest.game.clockStarted).toBe(true);
    },
  );
  it(
    'rejoins a third player to the elected successor without losing scores',
    { timeout: 10_000 },
    async () => {
      vi.useFakeTimers();
      const make = clients();
      const host = make(),
        successor = make(),
        follower = make();
      await host.app.multiplayer.createLobby(true);
      const code = host.net.code;
      await successor.app.multiplayer.joinLobby(code);
      await follower.app.multiplayer.joinLobby(code);
      await flushMessages();
      host.scores.set(follower.net.id, { name: 'player', kills: 3, deaths: 1 });
      host.app.match.sendScores();
      await flushMessages();
      const previousFollower = follower.net.id;
      host.net.leave();
      await flushMessages();
      await vi.advanceTimersByTimeAsync(1800);
      await flushMessages();
      expect(successor.net.isHost).toBe(true);
      expect(follower.net.active).toBe(true);
      expect(follower.net.authorityId).toBe(successor.net.id);
      expect(follower.net.code).toBe(`${code}-1`);
      expect(follower.game.state).toBe('lobby');
      expect(successor.lobby.players.has(previousFollower)).toBe(false);
      expect(successor.scores.get(follower.net.id)).toMatchObject({ kills: 3, deaths: 1 });
    },
  );
});
