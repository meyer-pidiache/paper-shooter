import { describe, expect, it, vi } from 'vitest';
import { browserPreferences, Preferences } from '../../src/platform/preferences';
import { DEFAULT_KEY_BINDINGS } from '../../src/shared/key-bindings';

describe('browser preferences', () => {
  it('preserves old Doodle saves and gives Paper values precedence', () => {
    const values = new Map([
      ['doodle_map', 'mexico'],
      ['doodle_best', '1200'],
      ['paper_name', 'paper'],
      ['doodle_name', 'doodle'],
    ]);
    const prefs = new Preferences({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    });
    expect(prefs.load()).toMatchObject({ mapKey: 'mexico', best: 1200, myName: 'paper' });
    expect(values.get('paper_map')).toBe('mexico');
    prefs.write('best', 2000);
    expect(values.get('doodle_best')).toBe('1200');
    expect(values.get('paper_best')).toBe('2000');
  });
  it('bounds corrupt settings and supports disabled storage', () => {
    const values: Record<string, string> = {
      paper_sens: 'Infinity',
      paper_checkpoint: '12',
      paper_best: '-1',
      paper_music: '0',
      paper_invert: '1',
    };
    const prefs = new Preferences({ getItem: (key) => values[key] ?? null, setItem: vi.fn() });
    expect(prefs.load(() => 0)).toMatchObject({
      best: 0,
      checkpoint: 10,
      myName: 'paper10',
      musicWanted: false,
      settings: { sens: 100, invert: true },
    });
    values.paper_sens = '999';
    expect(prefs.load().settings.sens).toBe(250);
    values.paper_sens = '';
    expect(prefs.load().settings.sens).toBe(100);
    const unavailable = new Preferences({
      getItem() {
        throw new Error();
      },
      setItem() {
        throw new Error();
      },
    });
    expect(unavailable.read('map')).toBeNull();
    expect(() => unavailable.write('map', 'mexico')).not.toThrow();
    expect(new Preferences(null).load(() => 0).mapKey).toBe('district');
    expect(browserPreferences().load().settings.sens).toBe(100);
  });
  it('loads theme, stats, and validated keyboard bindings with safe defaults', () => {
    const values = new Map<string, string>([
      ['paper_appearance', 'dark'],
      ['paper_nerdStats', '1'],
      ['paper_playerColor', 'graphite'],
      [
        'paper_keyBindings',
        JSON.stringify({ ...DEFAULT_KEY_BINDINGS, jump: { keys: ['KeyJ'], mouse: [] } }),
      ],
    ]);
    const prefs = new Preferences({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });
    expect(prefs.load()).toMatchObject({
      appearance: 'dark',
      playerColor: 'graphite',
      nerdStats: true,
      keyBindings: { jump: { keys: ['KeyJ'], mouse: [] } },
    });
    values.set('paper_appearance', 'sepia');
    values.set('paper_playerColor', '__proto__');
    values.set(
      'paper_keyBindings',
      JSON.stringify({ ...DEFAULT_KEY_BINDINGS, jump: { keys: ['KeyS'], mouse: [] } }),
    );
    const safe = prefs.load();
    expect(safe.appearance).toBe('light');
    expect(safe.playerColor).toBe('original');
    expect(safe.keyBindings.jump).toEqual(DEFAULT_KEY_BINDINGS.jump);
    values.set('paper_keyBindings', '{invalid json');
    expect(prefs.load().keyBindings.jump).toEqual(DEFAULT_KEY_BINDINGS.jump);
    expect(new Preferences(null).load().nerdStats).toBe(false);
  });
});
