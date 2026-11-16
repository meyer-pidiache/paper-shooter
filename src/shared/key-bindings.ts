export const KEY_BINDING_ACTIONS = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'sprint',
  'crouch',
  'dash',
  'fire',
  'aim',
  'grapple',
  'melee',
  'reload',
  'grenade',
  'slot1',
  'slot2',
  'slot3',
  'slot4',
  'slot5',
  'pause',
  'confirm',
  'score',
  'music',
  'talk',
] as const;

export type KeyBindingAction = (typeof KEY_BINDING_ACTIONS)[number];
export type BindingDevice = 'key' | 'mouse';
export interface ActionBindings {
  keys: string[];
  mouse: number[];
}
export type KeyBindings = Record<KeyBindingAction, ActionBindings>;

export const KEY_BINDING_LABELS: Record<KeyBindingAction, string> = {
  forward: 'Move forward',
  back: 'Move backward',
  left: 'Move left',
  right: 'Move right',
  jump: 'Jump',
  sprint: 'Sprint',
  crouch: 'Crouch / slide / air dash',
  dash: 'Air dash / dash slash',
  fire: 'Fire / slash',
  aim: 'Aim / block',
  grapple: 'Grapple',
  melee: 'Quick katana slash',
  reload: 'Reload',
  grenade: 'Grenade',
  slot1: 'Rifle',
  slot2: 'Shotgun',
  slot3: 'Sniper',
  slot4: 'Katana',
  slot5: 'Weapon slot 5',
  pause: 'Pause / menu',
  confirm: 'Confirm',
  score: 'Scoreboard',
  music: 'Music',
  talk: 'Talk',
};

export const DEFAULT_KEY_BINDINGS: Readonly<KeyBindings> = {
  forward: { keys: ['KeyW', 'ArrowUp'], mouse: [] },
  back: { keys: ['KeyS', 'ArrowDown'], mouse: [] },
  left: { keys: ['KeyA', 'ArrowLeft'], mouse: [] },
  right: { keys: ['KeyD', 'ArrowRight'], mouse: [] },
  jump: { keys: ['Space'], mouse: [] },
  sprint: { keys: ['ShiftLeft', 'ShiftRight'], mouse: [] },
  crouch: { keys: ['ControlLeft', 'KeyC'], mouse: [] },
  dash: { keys: ['KeyX', 'AltLeft'], mouse: [] },
  fire: { keys: [], mouse: [0] },
  aim: { keys: [], mouse: [2] },
  grapple: { keys: ['KeyQ', 'KeyE'], mouse: [1, 3] },
  melee: { keys: ['KeyF', 'KeyV'], mouse: [4] },
  reload: { keys: ['KeyR'], mouse: [] },
  grenade: { keys: ['KeyG'], mouse: [] },
  slot1: { keys: ['Digit1'], mouse: [] },
  slot2: { keys: ['Digit2'], mouse: [] },
  slot3: { keys: ['Digit3'], mouse: [] },
  slot4: { keys: ['Digit4'], mouse: [] },
  slot5: { keys: ['Digit5'], mouse: [] },
  pause: { keys: ['Escape', 'KeyP'], mouse: [] },
  confirm: { keys: ['Enter'], mouse: [] },
  score: { keys: ['Tab'], mouse: [] },
  music: { keys: ['KeyM'], mouse: [] },
  talk: { keys: ['KeyT'], mouse: [] },
};

export function cloneKeyBindings(
  bindings: Readonly<KeyBindings> = DEFAULT_KEY_BINDINGS,
): KeyBindings {
  return Object.fromEntries(
    KEY_BINDING_ACTIONS.map((action) => [
      action,
      { keys: [...bindings[action].keys], mouse: [...bindings[action].mouse] },
    ]),
  ) as KeyBindings;
}

function validKeyCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9]{0,23}$/.test(value);
}

function validList<T>(
  value: unknown,
  isValid: (item: unknown) => item is T,
  limit: number,
): T[] | null {
  if (!Array.isArray(value) || value.length > limit || !value.every(isValid)) return null;
  return [...new Set(value)];
}

/** Validate stored bindings as a whole so corrupted/conflicting data falls back safely. */
export function normalizeKeyBindings(value: unknown): KeyBindings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return cloneKeyBindings();
  const source = value as Record<string, unknown>;
  const result = {} as KeyBindings;
  const occupiedKeys = new Set<string>();
  const occupiedMouse = new Set<number>();
  for (const action of KEY_BINDING_ACTIONS) {
    const raw = source[action];
    const entry =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;
    const keys = entry ? validList(entry.keys, validKeyCode, 4) : null;
    const mouse = entry
      ? validList(
          entry.mouse,
          (button): button is number =>
            Number.isInteger(button) && Number(button) >= 0 && Number(button) <= 4,
          5,
        )
      : null;
    if (!keys || !mouse) return cloneKeyBindings();
    if (
      keys.some((code) => occupiedKeys.has(code)) ||
      mouse.some((button) => occupiedMouse.has(button))
    )
      return cloneKeyBindings();
    result[action] = { keys, mouse };
    for (const code of keys) occupiedKeys.add(code);
    for (const button of mouse) occupiedMouse.add(button);
  }
  return result;
}

export function bindingLabel(action: KeyBindingAction, bindings: Readonly<KeyBindings>): string {
  const entry = bindings[action];
  const labels = [...entry.keys.map(keyCodeLabel), ...entry.mouse.map(mouseButtonLabel)];
  return labels.length ? labels.join(' / ') : 'unassigned';
}

export function keyCodeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow'))
    return { Up: '↑', Down: '↓', Left: '←', Right: '→' }[code.slice(5)] ?? code;
  if (code === 'Space') return 'Space';
  if (code.startsWith('Shift')) return 'Shift';
  if (code.startsWith('Control')) return 'Ctrl';
  if (code.startsWith('Alt')) return 'Alt';
  if (code === 'Escape') return 'Esc';
  if (code === 'Enter') return 'Enter';
  return code;
}

export function mouseButtonLabel(button: number): string {
  return ['LMB', 'MMB', 'RMB', 'Mouse 4', 'Mouse 5'][button] ?? `Mouse ${button + 1}`;
}
