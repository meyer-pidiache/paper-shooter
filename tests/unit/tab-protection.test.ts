// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTabProtection } from '../../src/platform/tab-protection.js';

let protection: ReturnType<typeof createTabProtection> | undefined;
let restoreBrowser: (() => void) | undefined;

afterEach(() => {
  protection?.dispose();
  protection = undefined;
  restoreBrowser?.();
  restoreBrowser = undefined;
  vi.unstubAllGlobals();
});

function browser(keyboard?: { lock: (codes: string[]) => Promise<void>; unlock: () => void }) {
  vi.stubGlobal('navigator', Object.create(navigator, { keyboard: { value: keyboard } }));
  let fullscreen: Element | null = null;
  const root = document.documentElement;
  const enter = vi.fn(async () => {
    fullscreen = root;
  });
  const leave = vi.fn(async () => {
    fullscreen = null;
  });
  Object.defineProperties(document, {
    fullscreenElement: { configurable: true, get: () => fullscreen },
    exitFullscreen: { configurable: true, value: leave },
  });
  Object.defineProperty(root, 'requestFullscreen', { configurable: true, value: enter });
  restoreBrowser = () => {
    Reflect.deleteProperty(document, 'fullscreenElement');
    Reflect.deleteProperty(document, 'exitFullscreen');
    Reflect.deleteProperty(root, 'requestFullscreen');
  };
  protection = createTabProtection();
  return { protection, enter, leave };
}

function blocksLeaving() {
  return !window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
}

function capturesKey(code: string, ctrlKey = false) {
  return !window.dispatchEvent(new KeyboardEvent('keydown', { cancelable: true, code, ctrlKey }));
}

describe('accidental tab-close protection', () => {
  it('uses the leave confirmation during a match when the browser lacks keyboard lock', async () => {
    const { protection, enter } = browser();
    expect(blocksLeaving()).toBe(false);
    protection.sync(true, true);
    expect(blocksLeaving()).toBe(true);
    expect(capturesKey('KeyW', true)).toBe(false);
    await enter();
    protection.sync(true, true);
    expect(blocksLeaving()).toBe(true);
    protection.sync(true, false);
    expect(blocksLeaving()).toBe(true);
    protection.sync(false, false);
    expect(blocksLeaving()).toBe(false);
    protection.sync(true, true);
    protection.dispose();
    protection.sync(true, true);
    expect(blocksLeaving()).toBe(false);
  });

  it('holds the fallback until the lock resolves and releases capture on pause and fullscreen exit', async () => {
    const keyboard = { lock: vi.fn(async () => {}), unlock: vi.fn() };
    const { protection, enter, leave } = browser(keyboard);
    protection.toggleFullscreen();
    expect(enter).toHaveBeenCalledOnce();
    protection.sync(true, true);
    protection.sync(true, true);
    expect(keyboard.lock).toHaveBeenCalledExactlyOnceWith(['KeyW']);
    expect(blocksLeaving()).toBe(true);
    await Promise.resolve();
    expect(blocksLeaving()).toBe(false);
    expect(capturesKey('KeyW', true)).toBe(true);
    expect(capturesKey('KeyW')).toBe(false);
    expect(capturesKey('KeyK', true)).toBe(false);

    protection.sync(true, false);
    expect(keyboard.unlock).toHaveBeenCalledOnce();
    expect(capturesKey('KeyW', true)).toBe(false);
    expect(blocksLeaving()).toBe(true);

    protection.sync(true, true);
    await Promise.resolve();
    expect(blocksLeaving()).toBe(false);
    protection.toggleFullscreen();
    expect(leave).toHaveBeenCalledOnce();
    expect(capturesKey('KeyW', true)).toBe(false);
    protection.sync(true, true);
    expect(keyboard.unlock).toHaveBeenCalledTimes(2);
    expect(blocksLeaving()).toBe(true);
  });

  it('keeps the native fallback when keyboard lock is denied', async () => {
    const keyboard = {
      lock: vi.fn(async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      }),
      unlock: vi.fn(),
    };
    const { protection, enter } = browser(keyboard);
    await enter();
    protection.sync(true, true);
    await Promise.resolve();
    expect(blocksLeaving()).toBe(true);
  });

  it('ignores a lock response that arrives after leaving fullscreen', async () => {
    let grant!: () => void;
    const keyboard = {
      lock: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            grant = resolve;
          }),
      ),
      unlock: vi.fn(),
    };
    const { protection, enter, leave } = browser(keyboard);
    await enter();
    protection.sync(true, true);
    await leave();
    protection.sync(true, true);
    grant();
    await Promise.resolve();
    expect(keyboard.unlock).toHaveBeenCalledOnce();
    expect(blocksLeaving()).toBe(true);
    expect(capturesKey('KeyW', true)).toBe(false);
  });
});
