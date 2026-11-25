// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HUD } from '../../src/presentation/hud.js';
import { escapeHtml } from '../../src/presentation/html';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('HUD trust boundaries', () => {
  it('renders remote kill feed strings as text and preserves score styling', () => {
    const root = document.createElement('div');
    const hud = new HUD(root);
    hud.kill('<img src=x onerror=alert(1)>', 100);
    expect(root.querySelector('#killfeed img')).toBeNull();
    expect(root.querySelector('#killfeed')!.textContent).toContain('<img');
    expect(root.querySelector('#killfeed .pts')!.textContent).toBe('+100');
    for (let i = 0; i < 8; i++) hud.kill('player', 0);
    expect(root.querySelector('#killfeed')!.children).toHaveLength(6);
    vi.advanceTimersByTime(1800);
    expect(root.querySelector('#killfeed')!.children).toHaveLength(0);
  });
  it('escapes names before using trusted scoreboard templates', () => {
    expect(escapeHtml(`<img title="x">&'`)).toBe('&lt;img title=&quot;x&quot;&gt;&amp;&#39;');
  });
  it('emphasizes only the killer and keeps names and hit details as text', () => {
    const root = document.createElement('div');
    const hud = new HUD(root);
    hud.kill({ killer: '<ink>', after: ' erased <paper> · rifle headshot' }, 100);
    expect(root.querySelector('#killfeed .killer')?.textContent).toBe('<ink>');
    expect(root.querySelector('#killfeed > div')?.textContent).toBe(
      '<ink> erased <paper> · rifle headshot +100',
    );
    expect(root.querySelector('#killfeed ink, #killfeed paper')).toBeNull();
  });
  it('formats optional Nerd Stats and avoids writing the same display twice', () => {
    const root = document.createElement('div');
    const hud = new HUD(root);
    const stats = root.querySelector<HTMLElement>('#nerdStats')!;
    hud.setNerdStatsVisible(true);
    expect(stats.hidden).toBe(false);
    hud.setNerdStats(61.6, 13.37, 'HOST');
    expect(stats.textContent).toBe('FPS 62 · PING HOST 13.4 ms');
    hud.setNerdStats(61.6, 13.37, 'HOST');
    expect(stats.textContent).toBe('FPS 62 · PING HOST 13.4 ms');
    hud.setNerdStats(null, null, 'PEERS MEDIAN');
    expect(stats.textContent).toBe('FPS -- · PING PEERS MEDIAN -- ms');
    hud.setNerdStatsVisible(false);
    expect(stats.hidden).toBe(true);
  });
});
