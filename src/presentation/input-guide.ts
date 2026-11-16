export const KB_KEYS: Readonly<Record<string, string>> = {
  fire: 'LMB',
  aim: 'RMB',
  block: 'RMB',
  jump: 'Space',
  sprint: 'Shift',
  slide: 'C',
  dash: 'C',
  grapple: 'Q',
  melee: 'F',
  reload: 'R',
  grenade: 'G',
  focus: 'both mouse buttons (or X)',
  next: 'wheel',
  pause: 'Esc',
  confirm: 'Space',
  score: 'Tab',
};
export const PAD_KEYS: Readonly<Record<string, string>> = {
  fire: 'R2',
  aim: 'L2',
  block: 'L2',
  jump: '✕',
  sprint: 'L3',
  slide: '○',
  dash: '○',
  grapple: 'L1',
  melee: 'R1',
  reload: '□',
  grenade: 'R3',
  focus: 'L2 + R2',
  next: '△',
  pause: 'Options',
  confirm: '✕',
  score: 'Create',
};
export function controlsHTML(
  key: (action: string) => string = (action) => KB_KEYS[action] || action,
) {
  return `
<div class="cols">
  <div><div class="colhead">MOUSE + KEYBOARD</div>
    <div><b>${key('forward')} / ${key('back')} / ${key('left')} / ${key('right')}</b> move &nbsp; <b>Mouse</b> look &nbsp; <b>${key('sprint')}</b> sprint</div>
    <div><b>${key('fire')}</b> fire / slash &nbsp; <b>${key('aim')}</b> aim down sights / block</div>
    <div><b>${key('jump')}</b> jump (again on a wall = wall jump)</div>
    <div><b>${key('jump')}</b> again in the air = double jump</div>
    <div><b>${key('crouch')}</b> crouch / slide on the ground · also air dash while airborne</div>
    <div><b>${key('grapple')}</b> grapple: tap to swing, hold to reel, jump to launch</div>
    <div><b>${key('melee')}</b> quick katana slash &nbsp; <b>${key('reload')}</b> reload &nbsp; <b>${key('music')}</b> music</div>
    <div><b>${key('grenade')}</b> grenade · hold it to throw further</div>
    <div><b>${key('score')}</b> scoreboard (online) &nbsp; <b>${key('pause')}</b> pause</div>
    <div><b>${key('dash')}</b> air dash · ${key('aim')} + ${key('fire')} dash-slash when the gauge is lit</div>
    <div><b>${key('slot1')}–${key('slot4')} / wheel</b> rifle · shotgun · sniper · katana</div>
  </div>
  <div><div class="colhead">PS5 CONTROLLER</div>
    <div><b>L stick</b> move &nbsp; <b>R stick</b> look &nbsp; <b>L3</b> sprint</div>
    <div><b>R2</b> fire / slash &nbsp; <b>L2</b> aim / block</div>
    <div><b>✕</b> jump &nbsp; <b>○</b> slide · air dash</div>
    <div><b>L1</b> grapple (hold to reel, ✕ to launch)</div>
    <div><b>L2 + R2</b> dash-slash once the katana gauge is lit</div>
    <div><b>R1</b> quick katana slash, then back to your gun</div>
    <div><b>□</b> reload &nbsp; <b>△</b> next weapon</div>
    <div><b>R3 / d-pad up</b> grenade · hold to throw further</div>
    <div><b>Create</b> scoreboard (online) &nbsp; <b>Options</b> pause</div>
  </div>
</div>`;
}

export const CONTROLS_HTML = controlsHTML();
