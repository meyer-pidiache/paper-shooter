import { LEVELS, mapName } from '../domain/maps.js';
import type { MapKey } from '../domain/maps.js';
import { FFA_DURATIONS, FFA_TARGET, FFA_TIME } from '../domain/match.js';
import { escapeHtml as esc } from './html.js';
import { scoreRows } from './match.js';
import type {
  MainScreenView,
  OnlineScreenView,
  LobbyScreenView,
  LobbyListView,
  PauseScreenView,
  DeathScreenView,
} from './screen-views-types.js';

export function checkpointHTML(checkpoint: number) {
  if (checkpoint < 5) return '';
  let h = '<div class="checkpoints"><span>checkpoints</span>';
  for (let w = 5; w <= checkpoint; w += 5)
    h += `<button type="button" data-cp="${w}">WAVE ${w}</button>`;
  return h + '</div>';
}

export function mapHTML(selected: MapKey, canPick: boolean) {
  if (LEVELS.length < 2) return '';
  const buttons = LEVELS.map(({ key, name, blurb }) => {
    const active = key === selected;
    const disabled = canPick ? '' : 'disabled aria-disabled="true"';
    return `<button type="button" class="mapbtn${active ? ' on' : ''}" data-map="${key}" aria-pressed="${active}" ${disabled}>${name}<i>${blurb}</i></button>`;
  });
  return `<div class="mapsel" id="mapsel"><span>map</span>${buttons.join('')}</div>`;
}

export function mainHTML(view: MainScreenView, settings: string) {
  return `<h1>PAPER SHOOTER</h1><h2>a scribbled survival shooter</h2>
    <div class="mainbtns"><button type="button" class="start" id="soloBtn">START<i>solo · survive the waves</i></button><button type="button" id="onlineBtn">PLAY ONLINE<i>free for all or teams · up to 10 players</i></button></div>
    ${mapHTML(view.mapKey, true)}${settings}${checkpointHTML(view.checkpoint)}${view.best ? `<div class="beststat">best score: ${view.best}</div>` : ''}`;
}

export function onlineHTML(view: OnlineScreenView, list: string) {
  return `<h1>PLAY ONLINE</h1><h2>free for all or teams · first to ${FFA_TARGET} · up to 10 players</h2>
    <div class="online" id="online">
      <div class="row"><label for="setName">Your name</label><input type="text" class="namebox" id="setName" maxlength="14" value="${esc(view.myName)}"></div>
      <div class="quick-play"><button type="button" class="big" id="quickBtn" aria-describedby="quickHint">QUICK PLAY</button><p class="hint" id="quickHint">Joins an open public lobby or creates one for you.</p></div>
      ${view.rejoinCode ? `<div class="row"><button type="button" class="alt" id="rejoinBtn">REJOIN ${esc(view.rejoinCode)}</button></div>` : ''}
      <details class="online-flow" name="online-flow" id="createFlow"><summary>CREATE A GAME</summary><div class="row"><div class="radio" role="group" aria-label="Lobby visibility"><label><input type="radio" name="vis" value="public" ${view.isPublic ? 'checked' : ''}> Public · listed and available to Quick Play</label><label><input type="radio" name="vis" value="private" ${view.isPublic ? '' : 'checked'}> Private · anyone with the lobby code</label></div><button type="button" id="createBtn">CREATE LOBBY</button></div></details>
      <details class="online-flow" name="online-flow" id="joinFlow"><summary>JOIN WITH CODE</summary><p class="hint" id="codeHint">Enter the five-letter code shared by your friend.</p><div class="row"><input type="text" id="codeBox" placeholder="CODE" maxlength="5" autocomplete="off" aria-label="Lobby code" aria-describedby="codeHint"><button type="button" id="joinBtn">JOIN</button></div></details>
      <details class="online-flow" name="online-flow" id="browseFlow"><summary>BROWSE PUBLIC GAMES</summary><div class="lobbylist" id="lobbylist"><div class="row"><button type="button" class="alt" id="refreshBtn">REFRESH</button></div><div class="rows" id="lobbyRows" aria-live="polite">${list}</div></div></details>
      <div class="status" id="status" role="status">${esc(view.status || '')}</div>
      <div class="row"><button type="button" class="alt" id="backBtn">BACK</button></div>
    </div>`;
}

export function lobbyHTML(view: LobbyScreenView) {
  const rows = view.rows;
  const host = view.host;
  const n = rows.length;
  return `<h1>LOBBY</h1><h2>${view.mode === 'teams' ? 'teams' : 'free for all'} · first to ${FFA_TARGET} · ${n}/${view.maxPlayers} players</h2>
    <div class="online" id="online">
      <div class="row"><span>code</span><span class="code">${esc(String(view.code).replace(/-\d+$/, ''))}</span></div>
      ${view.mapLocked ? `<div class="row">Next map · <b>${mapName(view.mapKey)}</b></div>` : mapHTML(view.mapKey, host)}
      <div class="row">${host ? `<label for="matchMode">Mode</label><select id="matchMode"><option value="ffa" ${view.mode !== 'teams' ? 'selected' : ''}>Free for all</option><option value="teams" ${view.mode === 'teams' ? 'selected' : ''}>Teams</option></select>` : `<span>Mode: ${view.mode === 'teams' ? 'Teams' : 'Free for all'}</span>`}</div>
      <div class="row duration">
        ${host ? `<label for="matchDuration">Time limit</label><select id="matchDuration">${FFA_DURATIONS.map((seconds) => `<option value="${seconds}" ${seconds === (view.duration ?? FFA_TIME) ? 'selected' : ''}>${seconds / 60} minutes</option>`).join('')}</select>` : `<span>Time limit · ${(view.duration ?? FFA_TIME) / 60} minutes</span>`}
      </div>
      <div class="hint">${view.isPublic ? 'this lobby is public: anyone can quick play in, or type the code' : 'private lobby: friends type this code under PLAY ONLINE → JOIN'}</div>
      <div class="plist">${rows.map((p) => `<div class="${p.id === view.hostId ? 'host' : ''}${p.id === view.localId ? ' me' : ''}"><span>${esc(p.name)}${view.mode === 'teams' && p.team ? ' [' + esc(p.team.toUpperCase()) + ']' : ''}</span><span>${p.id === view.localId ? 'you' : ''}</span></div>`).join('')}</div>
      <div class="row"><button type="button" class="big" id="startBtn">START MATCH</button><button type="button" class="alt" id="leaveBtn">LEAVE</button></div>
      <div class="status" id="status">${esc(view.status || '')}</div><div class="hint">anyone can start · ${n < 2 ? 'people can still join once it is running' : n + ' players in'}</div>
    </div>`;
}

export function lobbyListHTML(view: LobbyListView) {
  if (view.busy) return '<div class="hint">Searching for public lobbies…</div>';
  if (!view.rows) return '';
  const status = view.incomplete
    ? '<div class="hint">Search incomplete. Press Refresh to try again.</div>'
    : view.rows.length === 0
      ? '<div class="hint">No public lobbies found.</div>'
      : '';
  return (
    status +
    view.rows
      .map(
        (l) =>
          `<div class="lobbyrow"><span class="code">${esc(l.code)}</span><span>${esc(l.hostName || 'someone')}'s lobby</span><span>${esc(l.players)}/${esc(l.max)}${l.inMatch ? ' · in a match' : ''}</span>${l.full ? '<span class="status">full</span>' : `<button type="button" data-join="${esc(l.code)}">JOIN</button>`}</div>`,
      )
      .join('')
  );
}

export function lobbyErrorHTML(message: string) {
  return `<div class="hint">Could not load public lobbies. ${esc(message)}. Press Refresh to try again.</div>`;
}

export function menuBtnHTML() {
  return '<div class="online menubtn"><div class="row"><button type="button" class="alt" id="menuBtn">MAIN MENU</button></div></div>';
}

const fullscreenButton =
  '<button type="button" class="alt" data-fullscreen>TOGGLE FULLSCREEN</button>';

export function pauseOnlineHTML(view: PauseScreenView, settings: string, confirm: string) {
  return `<h1>MENU</h1><h2>${view.mode === 'teams' ? 'teams' : 'free for all'} · lobby ${esc(view.code.replace(/-\d+$/, ''))}</h2><div class="scoreboard" id="pauseScores">${scoreRows(view.scores, view.localId)}</div>${settings}<div class="online" id="online"><div class="row"><button type="button" class="alt" id="leaveBtn">LEAVE MATCH</button>${fullscreenButton}</div></div><div class="go">CLICK ANYWHERE (or press ${confirm}) TO KEEP PLAYING</div>`;
}

export function pauseSoloHTML(
  view: { wave: number; score: number },
  settings: string,
  confirm: string,
) {
  return `<h1>PAUSED</h1><h2>wave ${view.wave} · score ${view.score}</h2>${settings}<div class="online"><div class="row"><button type="button" class="alt" id="menuBtn">MAIN MENU</button>${fullscreenButton}</div></div><div class="go">CLICK ANYWHERE (or press ${confirm}) TO RESUME</div>`;
}

export function deathHTML(view: DeathScreenView, newBest: boolean, confirm: string) {
  return `<h1>ERASED</h1><div class="stats">you survived <b>${view.wave}</b> wave${view.wave === 1 ? '' : 's'} · <b>${view.kills}</b> kills · score <b>${view.score}</b>${newBest ? ' · <b>NEW BEST</b>' : ` · best ${view.best}`}</div>${checkpointHTML(view.checkpoint)}${menuBtnHTML()}<div class="go">CLICK (or press ${confirm}) TO DRAW AGAIN</div>`;
}

export function clickToPlayHTML(confirm: string, mode?: 'ffa' | 'teams') {
  return `<h1>MATCH ON</h1><h2>${mode === 'teams' ? 'teams' : 'free for all'} · first to ${FFA_TARGET}</h2><div class="online">${fullscreenButton}</div><div class="go">CLICK ANYWHERE (or press ${confirm}) TO PLAY</div>`;
}
