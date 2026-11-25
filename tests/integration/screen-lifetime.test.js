// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { applicationFixture } from '../support/application.js';
let fixture;
afterEach(() => {
  fixture?.app.dispose();
  fixture = null;
});
it.each(['success', 'failure'])(
  'does not publish a lobby lookup %s after application disposal',
  async (outcome) => {
    fixture = applicationFixture();
    const { app, hud, net } = fixture;
    let resolve, reject;
    vi.spyOn(net, 'listLobbies').mockReturnValue(
      new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      }),
    );
    hud.el.panel.innerHTML = '<div id="lobbyRows"></div>';
    const rows = hud.el.panel.querySelector('#lobbyRows');
    const refreshing = app.screens.refreshLobbies();
    const before = rows.innerHTML;
    expect(before).toContain('Searching for public lobbies');
    app.dispose();
    if (outcome === 'success') resolve({ rows: [], incomplete: false });
    else reject(new Error('outdated failure'));
    await refreshing;
    expect(rows.innerHTML).toBe(before);
  },
);
