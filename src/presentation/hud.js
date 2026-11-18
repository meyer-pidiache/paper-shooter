import { escapeHtml } from './html.js';
import { KB_KEYS, PAD_KEYS } from './input-guide.js';
export { KB_KEYS, PAD_KEYS, CONTROLS_HTML } from './input-guide.js';
// DOM heads-up display drawn in "pen" style (multiplied over the paper canvas).
export class HUD {
  /** @param {((action: string) => string) | null} [keyLabel] */
  constructor(root, keyLabel = null) {
    this.root = root;
    this.keyLabel = keyLabel;
    root.innerHTML = `
      <div class="scope" id="scope"><div class="mask"></div><div class="ring"></div><div class="cx"></div><div class="cy"></div><div class="dot"></div></div>
      <div class="focus-meter" id="focusmeter"><div class="fm-label">KATANA</div><div class="fm-tube"><div class="fm-fill" id="fmfill"></div><i class="fm-f1"></i><i class="fm-f2"></i><i class="fm-f3"></i></div><div class="fm-ready" id="fmready">SLASH READY</div></div>
      <div class="focus-mark" id="focusmark"><i></i><i></i><i></i><i></i></div>
      <div class="crosshair" id="crosshair"><i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><i class="ch-dot"></i></div>
      <div class="grapple-ret" id="gret"></div><div class="gstam" id="gstam" hidden><i id="gstamfill"></i></div>
      <div class="hitmarker" id="hitmarker"><i></i><i></i></div>
      <div class="dmg-ind" id="dmg"></div>
      <div class="hud-tl"><div class="score">SCORE <b id="score">0</b></div><div class="nerd-stats" id="nerdStats" hidden aria-live="off"></div><div class="combo" id="combo"></div></div>
      <div class="hud-tr"><div class="wave">WAVE <b id="wave">1</b></div><div class="modifier" id="modifier"></div><div class="left"><b id="left">0</b> enemies left</div><div class="timer" id="timer"></div><div class="pvpscore" id="pvpscore" hidden></div></div><div class="board" id="board" hidden></div>
      <div class="bossbar" id="bossbar"><div class="bossname" id="bossname"></div><div class="bar big"><div class="fill red" id="bossfill"></div></div></div>
      <div class="hud-bl">
        <div class="health"><span>HP</span><div class="bar"><div class="fill" id="hpfill"></div></div><span id="hpnum">100</span></div>
        <div class="ammo"><b id="mag">30</b><span id="reserve">/120</span><span class="reloading" id="reloading"></span><span class="nades" id="nades" title="grenades"></span></div>
        <div class="tally" id="tally"></div>
      </div>
      <div class="hud-br"><div class="slots" id="slots"></div><div class="weapon" id="weapon">RIFLE</div><div class="hint" id="hint"></div></div>
      <div class="tip" id="tip"></div>
      <div class="message"><div class="msg-main" id="msg"></div><div class="msg-sub" id="msgsub"></div></div>
      <div class="killfeed" id="killfeed"></div>
      <div class="screen" id="screen"><div class="panel" id="panel"></div></div>`;
    const q = (id) => root.querySelector('#' + id);
    this.el = {
      crosshair: q('crosshair'),
      gret: q('gret'),
      hitmarker: q('hitmarker'),
      dmg: q('dmg'),
      score: q('score'),
      combo: q('combo'),
      wave: q('wave'),
      modifier: q('modifier'),
      left: q('left'),
      timer: q('timer'),
      hpfill: q('hpfill'),
      hpnum: q('hpnum'),
      mag: q('mag'),
      reserve: q('reserve'),
      reloading: q('reloading'),
      tally: q('tally'),
      weapon: q('weapon'),
      hint: q('hint'),
      slots: q('slots'),
      tip: q('tip'),
      msg: q('msg'),
      msgsub: q('msgsub'),
      killfeed: q('killfeed'),
      screen: q('screen'),
      panel: q('panel'),
      nades: q('nades'),
      scope: q('scope'),
      focusmark: q('focusmark'),
      focusmeter: q('focusmeter'),
      fmfill: q('fmfill'),
      bossbar: q('bossbar'),
      bossname: q('bossname'),
      bossfill: q('bossfill'),
      pvpscore: q('pvpscore'),
      board: q('board'),
      gstam: q('gstam'),
      gstamfill: q('gstamfill'),
      nerdStats: q('nerdStats'),
    };
    this._msgT = 0;
    this._scope = false;
    this._nades = -1;
    this._pad = false;
    this.onDevice = null;
    this._fmShow = false;
    this._fmFrac = -1;
    this._fmReady = false;
    this._lastTally = -1;
    this._lastSlots = '';
    this._ads = false;
    this._mode = '';
    this.onScreenClick = null;
    this.onScreenChange = null;
    this._tipT = 0;
    this._nerdStatsText = '';
    this.el.screen.addEventListener('click', () => {
      if (this.onScreenClick) this.onScreenClick();
    });
    this.el.screen.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLButtonElement && (event.key === 'Enter' || event.key === ' '))
        event.stopPropagation();
    });
  }
  // katana charge gauge: fills with katana kills, catches fire when a focus slash is ready
  setFocusMeter(show, frac, ready, label = 'KATANA') {
    const m = this.el.focusmeter;
    if (show !== this._fmShow) {
      this._fmShow = show;
      m.classList.toggle('on', show);
    }
    if (!show) return;
    if (label !== this._fmLabel) {
      this._fmLabel = label;
      m.querySelector('.fm-label').textContent = label;
    }
    const f = Math.max(0, Math.min(1, frac));
    if (Math.abs(f - (this._fmFrac ?? -1)) > 0.005) {
      this._fmFrac = f;
      this.el.fmfill.style.height = (f * 100).toFixed(1) + '%';
    }
    if (ready !== this._fmReady) {
      this._fmReady = ready;
      m.classList.toggle('ready', ready);
    }
  }
  setGrenades(n) {
    if (n === this._nades) return;
    this._nades = n;
    let h = '';
    for (let i = 0; i < n; i++) h += '<i></i>';
    this.el.nades.innerHTML = h;
  }
  // control labels follow whatever you touched last
  setDevice(pad) {
    if (pad === this._pad) return;
    this._pad = pad;
    this.root.classList.toggle('pad', pad);
    if (this.onDevice) this.onDevice(pad);
  }
  key(action) {
    if (this._pad) return PAD_KEYS[action] || action;
    const dynamic = this.keyLabel?.(action);
    return (dynamic && dynamic !== action ? dynamic : KB_KEYS[action]) || action;
  }
  setScope(on) {
    if (on === this._scope) return;
    this._scope = on;
    this.el.scope.classList.toggle('on', on);
  }
  setFocusMark(x, y) {
    const m = this.el.focusmark;
    if (x == null) {
      m.classList.remove('on');
      return;
    }
    m.classList.add('on');
    m.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }
  setSpread(px) {
    this.el.crosshair.style.setProperty('--s', px.toFixed(1) + 'px');
  }
  setCrosshairMode(mode) {
    this._mode = mode;
    this._applyCross();
  }
  setAds(on) {
    if (on === this._ads) return;
    this._ads = on;
    this._applyCross();
  }
  _applyCross() {
    this.el.crosshair.className = 'crosshair ' + this._mode + (this._ads ? ' ads' : '');
  }
  setGrappleStamina(f) {
    const show = f < 0.995;
    if (this.el.gstam.hidden === show) this.el.gstam.hidden = !show;
    if (show) {
      this.el.gstamfill.style.width = (f * 100).toFixed(0) + '%';
      this.el.gstam.classList.toggle('low', f < 0.2);
    }
  }
  grappleTarget(state) {
    this.el.gret.className =
      'grapple-ret' + (state === 1 ? ' on' : state === 2 ? ' on attached' : '');
  }
  hitmarker(kill = false, crit = false) {
    const h = this.el.hitmarker;
    h.className = 'hitmarker' + (kill ? ' kill' : '') + (crit ? ' crit' : '');
    void h.offsetWidth;
    h.classList.add('show');
  }
  setAmmo(mag, reserve, magSize, reloading = false) {
    this.el.mag.textContent = mag;
    this.el.reserve.textContent = '/' + reserve;
    this.el.reloading.textContent = reloading ? ' reloading…' : '';
    if (mag !== this._lastTally) {
      this._lastTally = mag;
      let s = '';
      for (let i = 0; i < Math.min(mag, 40); i++) s += '<i></i>';
      this.el.tally.innerHTML = s;
    }
  }
  setKatana() {
    this.el.mag.textContent = '∞';
    this.el.reserve.textContent = '';
    this.el.reloading.textContent = '';
    if (this._lastTally !== -1) {
      this.el.tally.innerHTML = '';
      this._lastTally = -1;
    }
  }
  setSlots(slots) {
    const labels = slots.map((_, i) => {
      const number = String(i + 1);
      const action = 'slot' + number;
      const binding = this.keyLabel?.(action);
      return binding && binding !== action ? binding : number;
    });
    const key = slots
      .map((s, i) => `${s.name}|${s.active ? 1 : 0}|${s.empty ? 1 : 0}|${s.ammo}|${labels[i]}`)
      .join(';');
    if (key === this._lastSlots) return;
    this._lastSlots = key;
    this.el.slots.innerHTML = slots
      .map(
        (s, i) =>
          `<div class="slot${s.active ? ' active' : ''}${s.empty ? ' empty' : ''}"><span class="num">${escapeHtml(labels[i])}</span>${s.name}<span class="sammo">${s.ammo}</span></div>`,
      )
      .join('');
  }
  setHealth(hp, max) {
    const f = Math.max(0, hp / max);
    this.el.hpfill.style.width = (f * 100).toFixed(1) + '%';
    this.el.hpnum.textContent = Math.ceil(hp);
    this.root.classList.toggle('low', f < 0.3);
  }
  setBoard(html) {
    const on = !!html;
    this.el.board.hidden = !on;
    if (on) this.el.board.innerHTML = html;
  }
  setPvpScore(html) {
    const on = !!html;
    this.el.pvpscore.hidden = !on;
    if (on) this.el.pvpscore.innerHTML = html;
    this.el.wave.parentElement.hidden = on;
    this.el.left.parentElement.hidden = on;
  }
  setWave(n, left) {
    this.el.wave.textContent = n;
    this.el.left.textContent = left;
  }
  setModifier(text) {
    this.el.modifier.textContent = text || '';
  }
  bindResultsReturn(onReturn) {
    const button = this.el.panel.querySelector('#resultsReturn');
    button?.addEventListener('click', (event) => {
      event.stopPropagation();
      onReturn();
    });
    button?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.stopPropagation();
      if (event.repeat) event.preventDefault();
    });
  }
  enableResultsReturn() {
    const button = this.el.panel.querySelector('#resultsReturn');
    if (button?.disabled) {
      button.disabled = false;
      button.hidden = false;
    }
  }
  setTimer(text, urgent = false) {
    const timer = this.el.timer;
    if (timer.textContent !== (text || '')) timer.textContent = text || '';
    timer.classList.toggle('urgent', urgent);
  }
  setScore(score, combo) {
    this.el.score.textContent = score;
    this.el.combo.textContent = combo > 1 ? 'combo x' + combo : '';
  }
  setWeapon(name, hint) {
    this.el.weapon.textContent = name;
    this.el.hint.textContent = hint || '';
  }
  setBoss(name, frac) {
    if (frac == null) {
      this.el.bossbar.classList.remove('show');
      return;
    }
    this.el.bossbar.classList.add('show');
    this.el.bossname.textContent = name;
    this.el.bossfill.style.width = (Math.max(0, frac) * 100).toFixed(1) + '%';
  }
  tip(text, dur = 5) {
    this.el.tip.innerHTML = text;
    this.el.tip.classList.add('show');
    this._tipT = dur;
  }
  message(main, sub = '', dur = 2.2) {
    const m = this.el.msg;
    m.textContent = main;
    m.classList.remove('show');
    void m.offsetWidth;
    m.classList.add('show');
    this.el.msgsub.textContent = sub;
    this._msgT = dur;
  }
  kill(text, pts) {
    const d = document.createElement('div');
    d.textContent = text;
    if (pts > 0) {
      const score = document.createElement('span');
      score.className = 'pts';
      score.textContent = '+' + pts;
      d.append(' ', score);
    }
    this.el.killfeed.appendChild(d);
    setTimeout(() => d.remove(), 1700);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.firstChild.remove();
  }
  damageFrom(angle) {
    const i = document.createElement('i');
    i.style.transform = `rotate(${((angle * 180) / Math.PI).toFixed(1)}deg)`;
    this.el.dmg.appendChild(i);
    setTimeout(() => i.remove(), 1000);
  }
  showScreen(html) {
    this.onScreenChange?.();
    this.el.panel.innerHTML = html;
    this.el.screen.classList.add('show');
  }
  hideScreen() {
    this.onScreenChange?.();
    this.el.screen.classList.remove('show');
  }
  setGameplayVisible(v) {
    this.root.classList.toggle('nogame', !v);
  }
  setNerdStatsVisible(visible) {
    this.el.nerdStats.hidden = !visible;
  }
  setNerdStats(fps, ping, label) {
    const fpsText = fps == null ? '--' : Math.round(fps).toString();
    const pingText = ping == null ? '--' : ping.toFixed(1);
    const text = `FPS ${fpsText} · PING ${label} ${pingText} ms`;
    if (text === this._nerdStatsText) return;
    this._nerdStatsText = text;
    this.el.nerdStats.textContent = text;
  }
  update(dt) {
    if (this._msgT > 0) {
      this._msgT -= dt;
      if (this._msgT <= 0) {
        this.el.msg.classList.remove('show');
        this.el.msgsub.textContent = '';
      }
    }
    if (this._tipT > 0) {
      this._tipT -= dt;
      if (this._tipT <= 0) this.el.tip.classList.remove('show');
    }
  }
}
