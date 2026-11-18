import { FFA_TIME } from '../domain/match.js';
import type { LobbyConnectionPorts } from './lobby-contracts.js';
import { SessionTasks } from './session-tasks.js';
import { HostMigration } from './host-migration.js';
import { connectionError, errorMessage } from '../presentation/network-errors.js';
/** Owns lobby setup/teardown and operation lifetime, without rendering DOM or mutating game phases. */
export class LobbyConnection {
  private readonly tasks = new SessionTasks();
  private readonly migration: HostMigration;
  constructor(private readonly ports: LobbyConnectionPorts) {
    this.migration = new HostMigration(this.tasks, ports, (reason) => this.leaveOnline(reason));
  }
  get migrating() {
    return this.tasks.migrating;
  }
  migrateHost() {
    return this.migration.run();
  }
  cancelPending() {
    this.tasks.cancel();
    this.ports.transport.leave();
  }
  dispose() {
    this.tasks.dispose();
    this.ports.transport.onAlias = null;
    this.ports.transport.leave();
  }
  leaveOnline(reason = '') {
    this.cancelPending();
    const { remoteIds, removeRemote, lobby, scores, session } = this.ports;
    for (const id of [...remoteIds()]) removeRemote(id);
    lobby.players.clear();
    scores.clear();
    lobby.status = reason;
    session.returnOnline();
  }
  async createLobby(isPublic: boolean) {
    const task = this.tasks.begin('connect');
    if (!task) return;
    const { transport, local, lobby, presentation, session } = this.ports;
    this.setStatus('opening a lobby…');
    try {
      await transport.host({ isPublic });
      if (!task.current) return;
    } catch (error) {
      if (!task.current) return;
      this.setStatus(connectionError(error));
      presentation.unlockButtons();
      return;
    }
    if (!transport.id) throw new Error('host identity missing after successful connection');
    lobby.isPublic = isPublic;
    lobby.map = local.mapKey;
    lobby.duration = FFA_TIME;
    lobby.players.clear();
    lobby.players.set(transport.id, { name: local.myName });
    lobby.hostId = transport.id;
    lobby.status = '';
    session.enterLobby();
  }
  async joinLobby(code: string) {
    const task = this.tasks.begin('connect');
    if (!task) return;
    const { transport, local, lobby, presentation, session } = this.ports;
    this.setStatus('connecting…');
    try {
      await transport.join(code, { name: local.myName });
      if (!task.current) return;
    } catch (error) {
      if (!task.current) return;
      this.setStatus(connectionError(error));
      presentation.unlockButtons();
      return;
    }
    lobby.isPublic = transport.isPublic;
    lobby.status = '';
    if (!transport.inMatch) session.enterLobby();
  }
  async quickPlay() {
    const task = this.tasks.begin('connect');
    if (!task) return;
    const { transport, local, lobby, presentation, session } = this.ports;
    try {
      await transport.quickJoin({ name: local.myName }, (status) => {
        if (task.current) this.setStatus(status);
      });
      if (!task.current) return;
      lobby.isPublic = true;
      lobby.status = '';
      if (!transport.inMatch) session.enterLobby();
      return;
    } catch (error) {
      if (!task.current) return;
      const message = errorMessage(error);
      if (!/no open public/.test(message)) {
        this.setStatus(connectionError(error));
        presentation.unlockButtons();
        return;
      }
    }
    this.setStatus('no open lobbies · opening a public one for you…');
    await this.createLobby(true);
  }
  setStatus(message: string) {
    this.ports.lobby.status = message;
    this.ports.presentation.status(message);
  }
}
