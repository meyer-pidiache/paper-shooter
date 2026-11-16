import { LEVELS } from '../domain/maps.js';
import type { MapKey } from '../domain/maps.js';
import { FFA_TARGET } from '../domain/match.js';
import { escapeHtml as esc } from './html.js';
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

export function mapHTML(sel: MapKey, canPick: boolean) {
  if (LEVELS.length < 2) return '';
  return `<div class="mapsel" id="mapsel"><span>map</span>${LEVELS.map((m) => `<button type="button" class="mapbtn${m.key === sel ? ' on' : ''}" data-map="${m.key}" ${canPick ? '' : 'disabled'}>${m.name}<i>${m.blurb}</i></button>`).join('')}</div>`;
}

export function mainHTML(view: MainScreenView, settings: string) {
  return `<h1>PAPER SHOOTER</h1><h2>a scribbled survival shooter</h2>
    <div class="mainbtns"><button type="button" class="start" id="soloBtn">START<i>solo · survive the waves</i></button><button type="button" id="onlineBtn">PLAY ONLINE<i>free for all · up to 10 players</i></button></div>
    ${mapHTML(view.mapKey, true)}${settings}${checkpointHTML(view.checkpoint)}${view.best ? `<div class="beststat">best score: ${view.best}</div>` : ''}`;
}

export function onlineHTML(view: OnlineScreenView, list: string) {
  return `<h1>PLAY ONLINE</h1><h2>free for all · first to ${FFA_TARGET} · up to 10 players</h2>
    <div class="online" id="online">
      <div class="row"><span>your name</span><input type="text" class="namebox" id="setName" maxlength="14" value="${esc(view.myName)}"></div>
      <div class="row"><button type="button" class="big" id="quickBtn">QUICK PLAY</button><span class="hint">jumps into an open public lobby, or opens one for you</span></div>
      <details class="online-flow" id="createFlow"><summary>CREATE A GAME</summary><p class="hint">Choose who can discover and join your lobby.</p><div class="row"><div class="radio"><label><input type="radio" name="vis" value="public" ${view.isPublic ? 'checked' : ''}> public · listed for everyone</label><label><input type="radio" name="vis" value="private" ${view.isPublic ? '' : 'checked'}> private · friends with the code</label></div><button type="button" id="createBtn">CREATE LOBBY</button></div></details>
      <details class="online-flow" id="joinFlow"><summary>JOIN WITH CODE</summary><p class="hint">Enter the five-letter code shared by your friend.</p><div class="row"><input type="text" id="codeBox" placeholder="CODE" maxlength="5" autocomplete="off" aria-label="Lobby code"><button type="button" id="joinBtn">JOIN</button></div></details>
      <details class="online-flow" id="browseFlow"><summary>BROWSE PUBLIC GAMES</summary><div class="lobbylist" id="lobbylist"><div class="row"><span>open public lobbies</span><button type="button" class="alt" id="refreshBtn">REFRESH</button></div><div class="rows" id="lobbyRows">${list}</div></div></details>
      <div class="status" id="status">${esc(view.status || '')}</div>
      ${view.rejoinCode ? `<div class="row"><button type="button" class="big" id="rejoinBtn">REJOIN ${esc(view.rejoinCode)}</button></div>` : ''}
      <div class="row"><button type="button" class="alt" id="backBtn">BACK</button></div>
    </div>`;
}

export function lobbyHTML(view: LobbyScreenView) {
  const rows = view.rows;
  const host = view.host;
  const n = rows.length;
  return `<h1>LOBBY</h1><h2>free for all · first to ${FFA_TARGET} · ${n}/${view.maxPlayers} players</h2>
    <div class="online" id="online">
      <div class="row"><span>code</span><span class="code">${esc(String(view.code).replace(/-\d+$/, ''))}</span></div>
      ${mapHTML(view.mapKey, host)}
      <div class="hint">${view.isPublic ? 'this lobby is public: anyone can quick play in, or type the code' : 'private lobby: friends type this code under PLAY ONLINE → JOIN'}</div>
      <div class="plist">${rows.map((p) => `<div class="${p.id === view.hostId ? 'host' : ''}${p.id === view.localId ? ' me' : ''}"><span>${esc(p.name)}</span><span>${p.id === view.localId ? 'you' : ''}</span></div>`).join('')}</div>
      <div class="row"><button type="button" class="big" id="startBtn">START MATCH</button><button type="button" class="alt" id="leaveBtn">LEAVE</button></div>
      <div class="status" id="status">${esc(view.status || '')}</div><div class="hint">anyone can start · ${n < 2 ? 'people can still join once it is running' : n + ' players in'}</div>
    </div>`;
}

export function lobbyListHTML(view: LobbyListView) {
  if (view.busy) return '<div class="hint">looking…</div>';
  if (!view.rows) return '<div class="hint">press refresh to look for open lobbies</div>';
  if (!view.rows.length) return '<div class="hint">hit QUICK PLAY to join a lobby</div>';
  return view.rows
    .map(
      (l) =>
        `<div class="lobbyrow"><span class="code">${esc(l.code)}</span><span>${esc(l.hostName || 'someone')}'s lobby</span><span>${esc(l.players)}/${esc(l.max)}${l.inMatch ? ' · in a match' : ''}</span>${l.full ? '<span class="status">full</span>' : `<button type="button" data-join="${esc(l.code)}">JOIN</button>`}</div>`,
    )
    .join('');
}

export function lobbyErrorHTML(message: string) {
  return `<div class="hint">could not look: ${esc(message)}</div>`;
}

export function menuBtnHTML() {
  return '<div class="online menubtn"><div class="row"><button type="button" class="alt" id="menuBtn">MAIN MENU</button></div></div>';
}

export function pauseOnlineHTML(view: PauseScreenView, settings: string, confirm: string) {
  return `<h1>MENU</h1><h2>free for all · lobby ${esc(view.code.replace(/-\d+$/, ''))}</h2><div class="scoreboard">${view.scores
    .map(
      ([id, s]) =>
        `<div class="${id === view.localId ? 'me' : ''}"><span>${esc(s.name)}</span><span>${esc(s.kills)} K · ${esc(s.deaths)} D</span></div>`,
    )
    .join(
      '',
    )}</div>${settings}<div class="online" id="online"><div class="row"><button type="button" class="alt" id="leaveBtn">LEAVE MATCH</button></div></div><div class="go">CLICK ANYWHERE (or press ${confirm}) TO KEEP PLAYING</div>`;
}

export function pauseSoloHTML(
  view: { wave: number; score: number },
  settings: string,
  confirm: string,
) {
  return `<h1>PAUSED</h1><h2>wave ${view.wave} · score ${view.score}</h2>${settings}${menuBtnHTML()}<div class="go">CLICK ANYWHERE (or press ${confirm}) TO RESUME</div>`;
}

export function deathHTML(view: DeathScreenView, newBest: boolean, confirm: string) {
  return `<h1>ERASED</h1><div class="stats">you survived <b>${view.wave}</b> wave${view.wave === 1 ? '' : 's'} · <b>${view.kills}</b> kills · score <b>${view.score}</b>${newBest ? ' · <b>NEW BEST</b>' : ` · best ${view.best}`}</div>${checkpointHTML(view.checkpoint)}${menuBtnHTML()}<div class="go">CLICK (or press ${confirm}) TO DRAW AGAIN</div>`;
}

export function clickToPlayHTML(confirm: string) {
  return `<h1>MATCH ON</h1><h2>free for all · first to ${FFA_TARGET}</h2><div class="go">CLICK ANYWHERE (or press ${confirm}) TO PLAY</div>`;
}
