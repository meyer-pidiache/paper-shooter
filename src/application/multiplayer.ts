import * as THREE from 'three';
import { LobbyConnection } from './lobby-connection.js';
import { connectionError } from '../presentation/network-errors.js';
import { INK } from '../shared/ink.js';
import { RemotePlayer } from '../gameplay/remote-player.js';
import { knownMap } from '../domain/maps.js';
import type {
  MultiplayerPorts,
  MultiplayerActions,
  MultiplayerPeer,
} from './multiplayer-contracts.js';
import { IdlePlayers } from './idle-players.js';
import { MatchClock } from './match-clock.js';
import { NetworkSync } from './network-sync.js';
import { CombatMessages } from './combat-messages.js';
import { RemoteRoster } from './remote-roster.js';
import { NetworkCombatFeedback } from '../presentation/network-combat-feedback.js';

export function createMultiplayer(ports: MultiplayerPorts, actions: MultiplayerActions) {
  const audio = ports.audio;
  const {
    remote,
    remoteServices,
    hud,
    net,
    lobby,
    scores,
    inMatch,
    game,
    player,
    input,
    effects,
    online,
    shotQueue,
  } = ports;
  const {
    renderLobby,
    sendScores,
    refreshScoreHud,
    farthestSpawnIndex,
    startMatch,
    breakProp,
    hostStart,
    endMatch,
    requestLobbyReturn,
    spawnPickup,
    removePickup,
    tallyDeath,
    applyScores,
    sortedScores,
    session,
    connectionPresentation,
  } = actions;
  const connection = new LobbyConnection({
    transport: net,
    lobby,
    scores,
    local: ports.local,
    removeRemote: (id) => removeRemote(id),
    remoteIds: () => remote.keys(),
    inMatch,
    broadcastLobby: () => broadcastLobby(),
    session,
    presentation: connectionPresentation,
  });
  const leaveOnline = (reason = '') => connection.leaveOnline(reason);
  const migrateHost = () => connection.migrateHost();
  const combatFeedback = new NetworkCombatFeedback({
    player,
    opponents: remote,
    effects,
    audio,
    input,
    hud,
  });
  const combatMessages = new CombatMessages({
    player,
    game,
    transport: net,
    scores,
    opponents: remote,
    feedback: {
      death: (point) => audio.enemyDie(point),
      kill: () => audio.kill(true),
      feed: (text) => hud.kill(text, 0),
      parry: (returned) => combatFeedback.parry(returned),
      cut: () => combatFeedback.cut(),
    },
    tally: tallyDeath,
  });

  const roster = new RemoteRoster<MultiplayerPeer>({
    peers: remote,
    lobby,
    scores,
    transport: net,
    createPeer: makeRemote,
    map: () => ports.local.mapKey,
    phase: () => game.state,
    inMatch,
    clock: () => ({ left: ports.local.matchLeft, on: game.clockStarted }),
    brokenIds: () =>
      ports.local.level.breakables.filter((prop) => !prop.alive).map((prop) => prop.id),
    farthestSpawnIndex,
    render: renderLobby,
    sendScores,
    refreshScores: refreshScoreHud,
    feed: (text) => hud.kill(text, 0),
  });
  function makeRemote(id: string, name: string) {
    const rp = new RemotePlayer(remoteServices, id, name, 0, INK.RED);
    rp.onDamage = (t, amount, fromPos) => {
      if (!ports.canHurt(t) || !t.alive) return;
      hud.hitmarker(false, false);
      net.sendTo(t.id, 'pdmg', {
        amount: Math.round(amount),
        from: fromPos
          ? [+fromPos.x.toFixed(1), +fromPos.y.toFixed(1), +fromPos.z.toFixed(1)]
          : null,
        by: net.id ?? undefined,
        src: 'grenade',
      });
    };
    return rp;
  }
  function addRemote(id: string, name: string) {
    return roster.add(id, name);
  }
  function removeRemote(id: string) {
    roster.remove(id);
  }
  function lobbyRows() {
    return roster.rows();
  }
  function broadcastLobby() {
    roster.broadcast();
  }

  net.onPeerLeave = (id) => roster.peerLeave(id);
  net.onDisconnect = () => {
    if (lobby.order && lobby.order.some((id) => id !== lobby.hostId)) void migrateHost();
    else if (game.state !== 'over') leaveOnline('the host left the lobby');
  };
  net.on('refused', (d) => leaveOnline(d.reason));
  net.hostName = ports.local.myName;
  net.onPeerJoin = (id, metadata) => roster.join(id, metadata);
  net.onHost('lobby', (data) => roster.receive(data));
  net.onHost('leave', (data) => roster.leave(data.id));
  net.onHost('start', (d) => {
    if (net.isHost) return;
    if (d.map) lobby.map = knownMap(d.map);
    if (d.duration !== undefined) lobby.duration = d.duration;
    startMatch(!!d.late, d.spawns ? (net.id === null ? undefined : d.spawns[net.id]) : d.spawn);
    if (d.clock) clock.receive(d.clock);
    if (d.broken)
      for (const id of d.broken) {
        const br = ports.local.level.breakables[id];
        if (br) breakProp(br, null, false, true);
      }
  });
  net.on('startreq', () => {
    if (net.isHost && game.state === 'lobby') hostStart();
  });
  net.onHost('end', (d) => endMatch(d));
  net.onHost('backtolobby', () => {
    if (!net.isHost) requestLobbyReturn();
  });
  net.onHost('pickup', (d) => {
    if (!net.isHost) spawnPickup(d.kind, new THREE.Vector3().fromArray(d.pos), d.id);
  });
  net.onHost('taken', (d) => {
    const p = ports.local.pickups.find((x) => x.id === d.id);
    if (p) removePickup(p);
  });
  net.on('take', (d) => {
    if (!net.isHost) return;
    const p = ports.local.pickups.find((x) => x.id === d.id);
    if (p) {
      removePickup(p);
      net.send('taken', { id: d.id });
    }
  });
  net.on('ps', (d, from) => {
    const r = remote.get(from);
    if (r) {
      r.push(d, performance.now() / 1000);
      r.lastSeen = performance.now();
    }
  });
  net.on('pdmg', (data, sender) => combatMessages.damage(data, sender));
  net.on('pdead', (data, sender) => combatMessages.death(data, sender));
  net.on('nade', (data) => combatMessages.grenade(data));
  net.on('brk', (d) => {
    const br = ports.local.level.breakables[d.id];
    if (br) breakProp(br, null, false);
  });
  net.on('parry', (data) => combatMessages.parry(data));
  net.on('shots', (data, sender) => combatFeedback.shots(data.k, data.e, sender));
  net.on('cut', () => combatMessages.cut());
  net.onHost('score', (rows) => {
    if (!net.isHost) applyScores(rows);
  });
  net.on('fell', (d, from) => {
    if (!net.isHost) return;
    const sc = scores.get(from);
    if (sc) {
      sc.kills = Math.max(0, sc.kills - 1);
      sendScores();
      net.send('feed', { text: sc.name + ' fell off the page · -1' });
      hud.kill(sc.name + ' fell off the page · -1', 0);
    }
  });
  net.onHost('feed', (d) => hud.kill(String(d.text || ''), 0));
  player.onFall = () => {
    if (!online() || !inMatch()) return;
    hud.kill('fell off the page · -1 kill', 0);
    if (net.isHost) {
      const sc = net.id === null ? undefined : scores.get(net.id);
      if (sc) {
        sc.kills = Math.max(0, sc.kills - 1);
        sendScores();
        net.send('feed', { text: sc.name + ' fell off the page · -1' });
      }
    } else net.send('fell', {});
  };
  const clock = new MatchClock({
    state: ports.local,
    game,
    transport: net,
    now: () => performance.now(),
    inMatch,
    opponentCount: () => remote.size,
    localName: () => ports.local.myName,
    sortedScores,
    timer: (text, urgent) => hud.setTimer(text, urgent),
    end: endMatch,
  });
  const idle = new IdlePlayers({
    transport: net,
    opponents: () => remote.entries(),
    inMatch,
    idleSeconds: () => input.idleSeconds,
    now: () => performance.now(),
    warn: () => {
      hud.message('STILL THERE?', 'move or you get kicked for inactivity', 3);
      audio.empty();
    },
    leave: leaveOnline,
    rejoin: (code) => {
      lobby.rejoinCode = code;
      if (code) connectionPresentation.start();
    },
    kick: (id) => {
      net.sendTo(id, 'kick', { reason: 'kicked for inactivity' });
      const connection = net.conns.get(id);
      setTimeout(() => {
        try {
          connection?.close();
        } catch {
          /* The channel may already be closed. */
        }
      }, 500);
    },
  });
  const sync = new NetworkSync({
    transport: net,
    player,
    opponents: () => remote.entries(),
    shotQueue,
    inMatch,
    migrating: () => connection.migrating,
    idleSeconds: () => input.idleSeconds,
    now: () => performance.now(),
    idle: (dt) => idle.update(dt),
    clock: (dt, frameAt) => clock.update(dt, frameAt),
    remove: removeRemote,
    migrate: migrateHost,
    feed: (text) => hud.kill(text, 0),
    broadcastLobby,
    sendScores,
  });
  net.onHost('clock', (data) => clock.receive(data));
  net.onHost('kick', (data) => idle.kicked(data.reason));
  function dispose() {
    net.onPeerJoin = null;
    net.onPeerLeave = null;
    net.onDisconnect = null;
    connection.dispose();
  }

  return {
    cancelPending: () => connection.cancelPending(),
    dispose,
    addRemote,
    removeRemote,
    lobbyRows,
    broadcastLobby,
    migrateHost,
    idleUpdate: (dt: number) => idle.update(dt),
    netUpdate: (dt: number, clockElapsed?: number, frameAt?: number) =>
      sync.update(dt, clockElapsed, frameAt),
    leaveOnline,
    createLobby: (isPublic: boolean) => connection.createLobby(isPublic),
    joinLobby: (code: string) => connection.joinLobby(code),
    quickPlay: () => connection.quickPlay(),
    friendlyError: connectionError,
    setStatus: (message: string) => connection.setStatus(message),
  };
}
