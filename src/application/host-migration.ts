import type { HostMigrationPorts } from './lobby-contracts.js';
import type { MigrationRejoin } from '../network/rejoin-credentials.js';
import { SessionTasks, type SessionTask } from './session-tasks.js';
interface Migration {
  myId: string;
  roster: string[];
  base: string;
  code: string;
  wasInMatch: boolean;
  rejoin?: MigrationRejoin;
}
/** Host authority recovery owns election order, generation codes and bounded/cancellable retries. */
export class HostMigration {
  constructor(
    private readonly tasks: SessionTasks,
    private readonly ports: HostMigrationPorts,
    private readonly leave: (reason: string) => void,
  ) {}
  async run() {
    if (this.tasks.migrating) return;
    const task = this.tasks.begin('migrate');
    if (!task) return;
    try {
      await this.recover(task);
    } catch {
      if (task.current) this.leave('could not recover the lobby after the host left');
    } finally {
      this.tasks.finish(task);
    }
  }
  private async recover(task: SessionTask) {
    const { lobby, transport, removeRemote, presentation, inMatch, scores } = this.ports;
    const myId = transport.id;
    const oldHost = lobby.hostId;
    const priorGeneration = Number(oldHost?.match(/-(\d+)$/)?.[1] ?? 0);
    lobby.gen = Math.max(lobby.gen || 0, priorGeneration) + 1;
    const base = (lobby.code || transport.code || '').replace(/-\d+$/, '');
    const code = base + '-' + lobby.gen;
    const roster = (lobby.order || []).filter((id) => id !== oldHost && lobby.players.has(id));
    if (!myId || !roster.length || !base) {
      this.leave('the host left the lobby');
      return;
    }
    const migration = {
      myId, roster, base, code, wasInMatch: inMatch(), rejoin: transport.migrationRejoin?.(),
    };
    // Capture identity/roster/clock authority before retiring the old endpoint clears its ids.
    transport.leave();
    if (oldHost) {
      const score = scores.get(oldHost);
      if (migration.wasInMatch && lobby.mode === 'teams' && score?.team) {
        lobby.teamBank ??= { red: 0, blue: 0 };
        lobby.teamBank[score.team] += score.kills;
        this.ports.reconcileRejoin?.(oldHost);
      }
      removeRemote(oldHost);
    }
    const successor = roster[0] === myId;
    presentation.message(
      'HOST LEFT',
      successor ? 'you are hosting now' : 'moving to the new host…',
      2.6,
    );
    if (successor) await this.host(task, migration);
    else await this.follow(task, migration);
  }
  private async host(task: SessionTask, migration: Migration) {
    const { transport, lobby, local, scores, broadcastLobby, presentation, session } = this.ports;
    const { myId, roster, base, code, wasInMatch } = migration;
    let hosted = false;
    for (let tries = 0; tries < 2 && !hosted; tries++) {
      try {
        await transport.host({ isPublic: lobby.isPublic, code });
        if (!task.current) return;
        hosted = true;
      } catch {
        if (!(await task.wait(800))) return;
      }
    }
    if (!hosted) {
      this.leave('could not take over the lobby');
      return;
    }
    const newId = transport.id;
    if (!newId) throw new Error('host identity missing after successful connection');
    const prior = lobby.players.get(myId);
    const name = prior?.name ?? local.myName;
    const score = scores.get(myId);
    const team = prior?.team ?? score?.team;
    lobby.players.delete(myId);
    lobby.players.set(newId, {
      name,
      color: local.playerColor,
      ...(lobby.mode === 'teams' && team ? { team } : {}),
    });
    scores.delete(myId);
    if (score) scores.set(newId, score);
    this.ports.reconcileRejoin?.(myId, newId);
    lobby.hostId = newId;
    lobby.code = code;
    const followers = roster.filter((id) => id !== myId);
    lobby.order = [newId, ...followers];
    lobby.migrationPeers = new Set(followers);
    transport.accepting = true;
    // Preserve the original clock update before requesting alias ownership.
    session.takeClockAuthority();
    transport.onAlias = () => {
      if (!task.current) return;
      broadcastLobby();
      presentation.feed('lobby code ' + base + ' is back');
    };
    transport.claimAlias(base);
    session.recoverHost(wasInMatch);
    broadcastLobby();
  }
  private async follow(task: SessionTask, migration: Migration) {
    const { transport, local, lobby, session } = this.ports;
    if (!(await task.wait(1200))) return;
    const deadline = performance.now() + 20000;
    let joined = false;
    while (!joined && performance.now() < deadline) {
      try {
        const metadata = { name: local.myName, color: local.playerColor, prev: migration.myId };
        if (migration.rejoin) await transport.join(migration.code, metadata, migration.rejoin);
        else await transport.join(migration.code, metadata);
        if (!task.current) return;
        joined = true;
      } catch {
        if (!(await task.wait(1200))) return;
      }
    }
    if (!joined) {
      this.leave('lost the match when the host left');
      return;
    }
    lobby.code = migration.code;
    session.recoverFollower(migration.wasInMatch);
  }
}
