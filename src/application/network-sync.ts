import { encodeLocal, type LocalSnapshotSource } from '../domain/player-snapshots.js';
import type { GamePayloads } from '../network/game-message-types.js';
import { IDLE_FLAG_SECONDS } from './idle-players.js';
export interface ReplicatedPeer {
  readonly name: string;
  readonly lastSeen: number;
  update(dt: number, time: number): void;
}
export interface NetworkSyncPorts {
  transport: {
    readonly active: boolean;
    readonly isHost: boolean;
    readonly hostId: string | null;
    readonly conns: Map<string, { close(): void }>;
    send<K extends 'ps' | 'leave'>(kind: K, data: GamePayloads[K], relay?: boolean): void;
    broadcast(kind: 'shots', data: GamePayloads['shots']): void;
  };
  player: LocalSnapshotSource & {
    readonly weaponIndex: number;
    readonly firing: boolean;
    readonly weapon: { kind: string };
  };
  opponents(): Iterable<readonly [string, ReplicatedPeer]>;
  shotQueue: number[];
  inMatch(): boolean;
  migrating(): boolean;
  idleSeconds(): number;
  now(): number;
  idle(dt: number): void;
  clock(dt: number): void;
  remove(id: string): void;
  migrate(): Promise<unknown>;
  feed(text: string): void;
  broadcastLobby(): void;
  sendScores(): void;
}
/** Advances replicas and replicates local state; no renderer, lobby UI or session state access. */
export class NetworkSync {
  private tick = 0;
  constructor(private readonly ports: NetworkSyncPorts) {}
  update(dt: number, clockElapsed = dt) {
    const { transport, opponents, player, shotQueue, inMatch, idleSeconds, now } = this.ports;
    this.ports.idle(dt);
    if (!transport.active) return;
    const time = now() / 1000;
    this.tick++;
    for (const [, opponent] of opponents()) opponent.update(dt, time);
    if (inMatch() && !this.ports.migrating()) this.removeSilentPeers();
    if (this.tick % 3 === 0 && inMatch()) {
      transport.send(
        'ps',
        encodeLocal(player, player.weaponIndex, {
          firing: player.firing,
          idle: idleSeconds() > IDLE_FLAG_SECONDS,
        }),
        true,
      );
    }
    if (shotQueue.length)
      transport.broadcast('shots', { k: player.weapon.kind, e: shotQueue.splice(0) });
    this.ports.clock(clockElapsed);
  }
  private removeSilentPeers() {
    const { transport, opponents, now, migrate, remove, feed, broadcastLobby, sendScores } =
      this.ports;
    for (const [id, opponent] of opponents()) {
      if (!opponent.lastSeen || now() - opponent.lastSeen <= 9000) continue;
      if (!transport.isHost && id === transport.hostId) {
        void migrate();
        break;
      }
      const name = opponent.name;
      remove(id);
      feed(name + ' lost connection');
      if (transport.isHost) {
        const connection = transport.conns.get(id);
        if (connection) {
          try {
            connection.close();
          } catch {
            /* The transport may have closed it first. */
          }
          transport.conns.delete(id);
        }
        transport.send('leave', { id });
        broadcastLobby();
        sendScores();
      }
    }
  }
}
