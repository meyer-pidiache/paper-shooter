import { FFA_TARGET, formatClock } from '../domain/match.js';
import type { Score, Winner } from '../domain/match.js';
import { escapeHtml as esc } from './html.js';

export interface MatchView {
  localId: string | null;
  rows: ReadonlyArray<readonly [string, Score]>;
  remaining: number;
  lobbyCode: string;
}
export function matchLeaders(view: MatchView): string {
  const { rows, localId } = view;
  const top = rows.slice(0, 3);
  const myIndex = rows.findIndex(([id]) => id === localId);
  if (myIndex >= 3) top.push(rows[myIndex]);
  return (
    top
      .map(
        ([id, score]) =>
          `<div class="row${id === localId ? ' me' : ''}"><span class="rank">${rows.findIndex(([key]) => key === id) + 1}.</span><span>${esc(score.name)}${id === localId ? ' (you)' : ''}</span><b>${esc(score.kills)}</b></div>`,
      )
      .join('') + `<div class="target">first to ${FFA_TARGET}</div>`
  );
}
export function matchBoard(view: MatchView, title: string): string {
  return `<h3>${esc(title)}</h3>${view.rows.map(([id, score]) => `<div class="${id === view.localId ? 'me' : ''}"><span>${esc(score.name)}${id === view.localId ? ' (you)' : ''}</span><span>${esc(score.kills)} kills · ${esc(score.deaths)} deaths</span></div>`).join('')}<div class="foot">first to ${FFA_TARGET} · ${formatClock(view.remaining)} left · lobby ${esc(view.lobbyCode.replace(/-\d+$/, ''))}</div>`;
}
export function matchResults(view: MatchView, winner: Winner): string {
  const title = winner.id === view.localId ? 'YOU WIN' : (winner.name || 'someone') + ' WINS';
  return `<h1>${esc(title)}</h1><div class="scoreboard">${view.rows.map(([id, score]) => `<div class="${id === view.localId ? 'me' : ''}"><span>${esc(score.name)}</span><span>${esc(score.kills)} K · ${esc(score.deaths)} D</span></div>`).join('')}</div><div class="online"><button type="button" id="resultsReturn" hidden disabled>BACK TO LOBBY</button></div><div class="hint">Returning to the lobby automatically</div>`;
}

/** Text-only feed label; the HUD publishes it through text nodes. */
export function localDeathNotice(
  killerName: string | null | undefined,
  how: string | null,
  hit: { readonly crit?: boolean } | null,
): string {
  return killerName
    ? 'erased by ' + killerName + (how ? ' · ' + how + (hit?.crit ? ' headshot' : '') : '')
    : 'erased';
}
