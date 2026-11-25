import { expect, it, vi } from 'vitest';
import { LobbyBrowser } from '../../src/application/lobby-browser.js';
import type { LobbyBrowseView, LobbyRowView } from '../../src/presentation/screen-views-types.js';
const row: LobbyRowView = {
  code: 'ABCDE',
  hostName: 'paper',
  players: 1,
  max: 10,
  inMatch: false,
  full: false,
};
it('coalesces concurrent refreshes and publishes busy before the completed cache', async () => {
  let complete!: (result: LobbyBrowseView) => void;
  const fetch = vi.fn(
    () =>
      new Promise<LobbyBrowseView>((resolve) => {
        complete = resolve;
      }),
  );
  const events: unknown[] = [];
  const browser = new LobbyBrowser({
    active: () => false,
    name: () => 'paper',
    fetch,
    changed: (error) => events.push({ error, busy: browser.view.busy, rows: browser.view.rows }),
  });
  const first = browser.refresh();
  await browser.refresh();
  expect(fetch).toHaveBeenCalledOnce();
  expect(events).toEqual([{ error: null, busy: true, rows: null }]);
  complete({ rows: [row], incomplete: false });
  await first;
  expect(events.at(-1)).toEqual({ error: null, busy: false, rows: [row] });
});
it('reads the current player name on each new request and skips active sessions', async () => {
  const profile = { name: 'before', active: true };
  const fetch = vi.fn(async () => ({ rows: [], incomplete: false }));
  const browser = new LobbyBrowser({
    active: () => profile.active,
    name: () => profile.name,
    fetch,
    changed: vi.fn(),
  });
  await browser.refresh();
  expect(fetch).not.toHaveBeenCalled();
  profile.active = false;
  await browser.refresh();
  expect(fetch).toHaveBeenLastCalledWith('before');
  profile.name = 'after';
  await browser.refresh();
  expect(fetch).toHaveBeenLastCalledWith('after');
});
it('reports a failure without retaining it as cached lobby content and permits retry', async () => {
  const error = new Error('lookup failed');
  const changed = vi.fn();
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(error)
    .mockResolvedValueOnce({ rows: [row], incomplete: false });
  const browser = new LobbyBrowser({ active: () => false, name: () => 'paper', fetch, changed });
  await browser.refresh();
  expect(changed).toHaveBeenLastCalledWith(error);
  expect(browser.view).toEqual({ busy: false, rows: [], incomplete: false });
  await browser.refresh();
  expect(changed).toHaveBeenLastCalledWith(null);
  expect(browser.view.rows).toEqual([row]);
});
it('retires pending publication and refuses new requests after disposal', async () => {
  let reject!: (reason: Error) => void;
  const fetch = vi.fn(
    () =>
      new Promise<LobbyBrowseView>((_resolve, no) => {
        reject = no;
      }),
  );
  const changed = vi.fn();
  const browser = new LobbyBrowser({ active: () => false, name: () => 'paper', fetch, changed });
  const pending = browser.refresh();
  browser.dispose();
  reject(new Error('late failure'));
  await pending;
  expect(changed).toHaveBeenCalledOnce();
  await browser.refresh();
  expect(fetch).toHaveBeenCalledOnce();
});
