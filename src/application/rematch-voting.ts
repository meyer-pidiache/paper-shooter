import { MAP_VOTE_SECONDS, MapVote } from '../domain/map-vote.js';
import { rankScores } from '../domain/match.js';
import type { MapKey } from '../domain/maps.js';
import type { GamePayloads } from '../network/game-message-types.js';
import type { SessionPorts } from './session-contracts.js';

type Ports = Pick<
  SessionPorts,
  'game' | 'transport' | 'lobby' | 'scores' | 'screen' | 'input' | 'mapVoteView' | 'broadcastLobby'
>;

function remaining(elapsed: number): number {
  return Math.max(0, Math.ceil(MAP_VOTE_SECONDS - elapsed));
}

/** Owns the post-match ballot and projects its state through a narrowly scoped view. */
export class RematchVoting {
  private vote: MapVote | null = null;
  private armed = false;

  constructor(private readonly ports: Ports) {}

  start(id?: number) {
    this.clear();
    if (id === undefined) return;
    const { lobby, scores, screen } = this.ports;
    const ranking = rankScores(scores)
      .map(([peerId]) => peerId)
      .filter((peerId) => lobby.players.has(peerId));
    this.vote = new MapVote(id, ranking, lobby.map ?? screen.mapKey);
  }

  clear() {
    this.vote = null;
    this.armed = false;
  }

  get active(): boolean {
    return this.vote !== null;
  }

  cast(map: MapKey) {
    const { game, transport } = this.ports;
    const vote = this.vote;
    if (
      !vote ||
      game.state !== 'over' ||
      !remaining(game.overT) ||
      !transport.active ||
      !transport.id
    )
      return;
    const ballot = { voteId: vote.id, map };
    if (transport.isHost) this.receiveBallot(ballot, transport.id);
    else transport.send('mapvote', ballot);
  }

  receiveBallot(data: GamePayloads['mapvote'], sender: string) {
    const { game, transport, lobby } = this.ports;
    const vote = this.vote;
    if (
      !transport.isHost ||
      game.state !== 'over' ||
      !remaining(game.overT) ||
      !vote ||
      vote.id !== data.voteId ||
      !lobby.players.has(sender) ||
      !vote.cast(sender, data.map)
    )
      return;
    transport.send('mapvotes', { voteId: vote.id, ballots: vote.entries });
    this.present(vote);
  }

  receiveState(data: GamePayloads['mapvotes']) {
    const vote = this.vote;
    if (!vote || vote.id !== data.voteId || this.ports.game.state !== 'over') return;
    vote.receive(data.ballots);
    this.present(vote);
  }

  update(previous: number) {
    const vote = this.vote;
    if (!vote) return;
    const { input, game, mapVoteView } = this.ports;
    if (remaining(previous) !== remaining(game.overT)) this.present(vote);
    if (!input.usingGamepad) return;
    if (input.pressed('prevWeapon')) mapVoteView.moveFocus(-1);
    if (input.pressed('nextWeapon')) mapVoteView.moveFocus(1);
    if (!input.down('jump') && !input.down('confirm')) this.armed = true;
    if (this.armed && (input.pressed('jump') || input.pressed('confirm'))) mapVoteView.confirm();
  }

  close(): boolean {
    const vote = this.vote;
    if (!vote) return true;
    const { game, lobby, transport, broadcastLobby } = this.ports;
    if (!transport.active || (remaining(game.overT) && !vote.complete)) return false;
    lobby.map = vote.winner();
    lobby.mapLocked = true;
    broadcastLobby();
    return true;
  }

  finishAfterMigration() {
    // Settle the last shared ballots before replacement connections change player IDs.
    if (this.vote) this.ports.game.overT = MAP_VOTE_SECONDS;
  }

  private present(vote: MapVote) {
    const { game, transport, mapVoteView } = this.ports;
    mapVoteView.update(vote.counts, vote.selection(transport.id), remaining(game.overT));
  }
}
