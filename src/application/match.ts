import { Vector3 } from 'three';
import { choose } from '../engine/math.js';
import { FFA_TARGET, rankScores, recordDeath, parseScoreRows } from '../domain/match.js';
import type { WireVector } from '../network/game-message-types.js';
import type { PlayerHitReceipt } from '../gameplay/player/services.js';
import type { Winner } from './session-contracts.js';
import type { MatchPorts } from './match-contracts.js';
import { matchBoard, matchLeaders, matchResults, localDeathNotice } from '../presentation/match.js';

const HOW: ReadonlyMap<string, string> = new Map([
  ['rifle', 'rifle'],
  ['shotgun', 'shotgun'],
  ['sniper', 'sniper'],
  ['katana', 'katana'],
  ['grenade', 'grenade'],
  ['deflect', 'their own bullet'],
]);
function ragdollOverkill(hit: Pick<PlayerHitReceipt, 'crit' | 'amount' | 'src'> | null) {
  return !!(hit?.crit || (hit?.amount ?? 0) >= 90 || hit?.src === 'katana');
}
/** Match rules and ordered reports; session owns phases and presentation owns HTML. */
export class MatchController {
  constructor(private readonly ports: MatchPorts) {}
  howWord(source?: string) {
    return source ? (HOW.get(source) ?? null) : null;
  }
  spawnSpots() {
    const level = this.ports.level();
    return level.arenaSpawns?.length ? level.arenaSpawns : level.spawns;
  }
  arenaSpawn() {
    const others = [...this.ports.opponents()].filter(
      (actor) => actor.alive && actor.root?.visible,
    );
    const scored = this.spawnSpots().map((point) => ({
      point,
      distance: others.reduce(
        (nearest, actor) => Math.min(nearest, actor.body.pos.distanceTo(point)),
        999,
      ),
    }));
    scored.sort((a, b) => b.distance - a.distance);
    return choose(scored.slice(0, Math.min(3, scored.length))).point.clone();
  }
  farthestSpawnIndex() {
    const bodies = [this.ports.player, ...this.ports.opponents()].filter((actor) => actor.alive);
    let best = 0,
      bestDistance = -1;
    this.spawnSpots().forEach((point, index) => {
      const distance = bodies.reduce(
        (nearest, actor) => Math.min(nearest, actor.body.pos.distanceTo(point)),
        999,
      );
      if (distance > bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }
  onLocalDeath() {
    const { player, online, session, transport, hud, scores } = this.ports;
    if (!online()) {
      session.playerDied();
      return;
    }
    const killer = player.lastHitBy || null;
    const hit = player.lastHit;
    let direction: WireVector | null = null;
    if (hit?.from) {
      const offset = player.center.clone().sub(new Vector3().fromArray(hit.from)).normalize();
      direction = [+offset.x.toFixed(2), +offset.y.toFixed(2), +offset.z.toFixed(2)];
    }
    const how = killer ? this.howWord(hit?.src) : null;
    transport.broadcast('pdead', {
      killer,
      dir: direction,
      over: ragdollOverkill(hit),
      how,
      crit: !!hit?.crit,
    });
    if (transport.isHost && transport.id !== null) this.tallyDeath(transport.id, killer);
    session.playerDied();
    const killerName = killer ? scores.get(killer)?.name : null;
    hud.kill(localDeathNotice(killerName, how, hit), 0);
  }
  respawnLocal() {
    const { player, localName, session, hud, spawnFeedback } = this.ports;
    player.reset(this.arenaSpawn());
    player.name = localName();
    player.lastHitBy = null;
    player.lastHit = null;
    session.playerRespawned();
    player.shieldT = 2;
    hud.tip('spawn protection · 2s', 1.6);
    spawnFeedback(player.center);
  }
  tallyDeath(victim: string, killer?: string | null) {
    recordDeath(this.ports.scores, victim, killer);
    this.sendScores();
    this.checkWin();
  }
  sendScores() {
    const rows = [...this.ports.scores].map(([id, score]) => ({ id, ...score }));
    this.ports.transport.send('score', rows);
    this.applyScores(rows);
  }
  applyScores(value: unknown) {
    const rows = parseScoreRows(value);
    if (!rows) return;
    this.ports.scores.clear();
    for (const { id, ...score } of rows) this.ports.scores.set(id, score);
    this.refreshScoreHud();
  }
  sortedScores() {
    return rankScores(this.ports.scores);
  }
  private view() {
    return {
      localId: this.ports.transport.id,
      rows: this.sortedScores(),
      remaining: this.ports.remainingTime(),
      lobbyCode: this.ports.lobbyCode(),
    };
  }
  refreshScoreHud() {
    const { online, hud, boardVisible } = this.ports;
    if (!online()) return;
    hud.setPvpScore(matchLeaders(this.view()));
    hud.setModifier('');
    if (boardVisible()) hud.setBoard(this.boardHTML());
  }
  boardHTML(title = 'FREE FOR ALL') {
    return matchBoard(this.view(), title);
  }
  checkWin() {
    const { transport, online, finished, scores } = this.ports;
    if (!transport.isHost || !online() || finished()) return;
    let winner: Winner | null = null;
    for (const [id, score] of scores)
      if (score.kills >= FFA_TARGET) winner = { id, name: score.name };
    if (winner) {
      transport.send('end', winner);
      this.endMatch(winner);
    }
  }
  endMatch(winner: Winner) {
    if (this.ports.finished()) return;
    const { session, endFocus, exitLock, hud } = this.ports;
    session.finishMatch(winner);
    endFocus();
    exitLock();
    hud.setBoard(null);
    hud.setGameplayVisible(false);
    hud.showScreen(matchResults(this.view(), winner));
    hud.bindResultsReturn(() => session.returnFromResults());
  }
}
