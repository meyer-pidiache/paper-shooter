import { expect, test } from '@playwright/test';

test('a static deployment starts Mexico without a project API', async ({ page }) => {
  const errors = [];
  const apiRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'PAPER SHOOTER', exact: true })).toBeVisible();
  await page.locator('[data-map="mexico"]').click();
  await page.locator('#soloBtn').click();
  await expect
    .poll(() => page.evaluate(() => window.__game.inspect()))
    .toMatchObject({ state: 'play', map: 'mexico', wave: 1, hp: 120 });
  await page.keyboard.down('Digit2');
  await expect.poll(() => page.evaluate(() => window.__game.inspect().weapon)).toBe('shotgun');
  await page.keyboard.up('Digit2');
  expect(errors).toEqual([]);
  expect(apiRequests).toEqual([]);
});

test('solo can pause and resume with the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.locator('#soloBtn').click();
  await page.keyboard.down('Escape');
  await expect(page.getByRole('heading', { name: 'PAUSED' })).toBeVisible();
  await page.keyboard.up('Escape');
  await page.keyboard.down('Space');
  await expect.poll(() => page.evaluate(() => window.__game.inspect().state)).toBe('play');
  await page.keyboard.up('Space');
});

test('Paper settings survive a reload and inherit existing Doodle saves', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('paper_map');
    localStorage.removeItem('paper_best');
    localStorage.setItem('doodle_map', 'mexico');
    localStorage.setItem('doodle_best', '4321');
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'PAPER SHOOTER' })).toBeVisible();
  await expect(page.locator('.beststat')).toContainText('4321');
  await expect(page.locator('[data-map="mexico"]')).toHaveClass(/on/);
  await page.getByRole('button', { name: 'Settings & Controls' }).click();
  await page.locator('#setSens').evaluate((input) => {
    input.value = '150';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Settings & Controls' }).click();
  await expect(page.locator('#setSens')).toHaveValue('150');
});

test('settings stay usable on resize without moving the main menu', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.goto('/');
  const opener = page.getByRole('button', { name: 'Settings & Controls' });
  const modal = page.getByRole('dialog', { name: 'Settings & Controls' });
  const menu = page.locator('.panel');
  const before = await menu.boundingBox();
  await opener.click();
  await expect(modal).toBeVisible();
  expect(await menu.boundingBox()).toEqual(before);
  await expect(modal.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(modal.getByRole('button', { name: 'Preferences' })).toBeFocused();
  await modal.getByRole('button', { name: 'Key bindings' }).click();

  await page.setViewportSize({ width: 320, height: 360 });
  const scroll = modal.locator('.settings-scroll');
  expect(await scroll.evaluate((el) => el.scrollWidth)).toBe(
    await scroll.evaluate((el) => el.clientWidth),
  );
  const jump = modal.getByRole('button', { name: 'Change key for Jump' });
  await jump.click();
  expect(await scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(modal.getByRole('status')).toContainText('cancelled');
  await expect(modal).toBeVisible();
  await jump.click();
  await page.keyboard.press('j');
  await expect(jump).toBeFocused();
  await expect(modal.getByRole('status')).toContainText('now uses j');
  await modal.getByRole('button', { name: 'Control guide' }).click();
  await expect(modal.getByText('PS5 CONTROLLER')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(opener).toBeFocused();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('paper_keyBindings')).jump),
  ).toEqual({ keys: ['KeyJ'], mouse: [] });
});

test('closing settings during binding capture keeps the solo game paused', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.goto('/');
  const opener = page.getByRole('button', { name: 'Settings & Controls' });
  const modal = page.getByRole('dialog', { name: 'Settings & Controls' });
  await page.locator('#soloBtn').click();
  await page.keyboard.down('Escape');
  await expect(page.getByRole('heading', { name: 'PAUSED' })).toBeVisible();
  await page.keyboard.up('Escape');
  await opener.click();
  await page.mouse.click(5, 5);
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Key bindings' }).click();
  await modal.getByRole('button', { name: 'Change mouse for Jump' }).click();
  await modal.getByRole('button', { name: 'Close' }).click();
  await expect(modal).toBeHidden();
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => window.__game.inspect().state)).toBe('pause');
  expect(await page.evaluate(() => localStorage.getItem('paper_keyBindings'))).toBeNull();
});

test('online actions can be explored independently with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/');
  await page.locator('#soloBtn').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /play online/i })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'QUICK PLAY' })).toBeVisible();
  await page.getByText('CREATE A GAME', { exact: true }).press('Enter');
  await expect(page.getByRole('radio', { name: /Public/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Private/ })).toBeVisible();
  await page.getByText('JOIN WITH CODE', { exact: true }).press('Enter');
  await expect(page.getByRole('textbox', { name: 'Lobby code' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'CREATE LOBBY' })).toBeHidden();
  await page.getByText('BROWSE PUBLIC GAMES', { exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'REFRESH' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Lobby code' })).toBeHidden();
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 640 });
    const flow = await page.locator('#browseFlow').boundingBox();
    const content = await page.locator('#lobbylist').boundingBox();
    expect(Math.abs(flow.x + flow.width / 2 - (content.x + content.width / 2))).toBeLessThan(1);
  }
  await page.getByRole('button', { name: 'BACK' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'PAPER SHOOTER' })).toBeVisible();
});

test('the compact online leaderboard fits above the kill feed and Tab shows all players', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/');
  await page.evaluate(() => {
    const app = window.__game;
    app.net.id = 'local';
    for (let i = 1; i <= 6; i++) app.lobby.players.set('peer-' + i, { name: 'Player ' + i });
    app.lobby.players.set('local', { name: 'Paper' });
    app.input.pointerLocked = true;
    app.startMatch(false, 0);
    app.hud.kill('Player 1 erased Player 2', 0);
    app.hud.setTimer('0:08', true);
  });
  const leaders = page.locator('#pvpscore');
  await expect(leaders.locator('.row')).toHaveCount(5);
  await expect(leaders.locator('.row.me')).toContainText('7.');
  await expect(leaders).toContainText('Hold Tab for full scoreboard');
  const scoreBox = await leaders.boundingBox();
  const feedBox = await page.locator('#killfeed').boundingBox();
  expect(feedBox.y).toBeGreaterThanOrEqual(scoreBox.y + scoreBox.height);
  await page.keyboard.down('Tab');
  await expect(page.locator('#board')).toContainText('Player 6');
  await expect(page.locator('#board')).toBeVisible();
  await page.keyboard.up('Tab');
  await expect(page.locator('#board')).toBeHidden();
});

test('distinguishes empty and incomplete lobby searches and retains full responses', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => {
    const { net } = window.__game;
    const events = () => {
      const listeners = new Map();
      return {
        on: (type, callback) => listeners.set(type, callback),
        off: (type) => listeners.delete(type),
        emit: (type, payload) => listeners.get(type)?.(payload),
      };
    };
    net.testSearch = 'empty';
    net.host = () => {
      throw new Error('Quick Play should not create a lobby after a timeout');
    };
    net.discovery.openPeer = async () => {
      const peer = { ...events(), open: true, destroy() {} };
      peer.connect = (id) => {
        const connection = {
          ...events(),
          open: false,
          send() {},
          close() {
            this.open = false;
            this.emit('close');
          },
        };
        queueMicrotask(() => {
          if (net.testSearch !== 'empty' && id === net.prefix + 'PUB1') return;
          if (net.testSearch === 'partial' && id === net.prefix + 'PUB0') {
            connection.open = true;
            connection.emit('open');
            connection.emit('data', {
              t: 'refused',
              d: { reason: 'full', code: 'PUB0', hostName: 'Ink', players: 10, max: 10 },
            });
            connection.close();
          } else {
            peer.emit('error', {
              type: 'peer-unavailable',
              message: 'Could not connect to peer ' + id,
            });
          }
        });
        return connection;
      };
      return peer;
    };
  });
  await page.locator('#onlineBtn').click();
  await page.locator('#browseFlow summary').click();
  await expect(page.locator('#lobbyRows')).toHaveText('No public lobbies found.');

  await page.evaluate(() => {
    window.__game.net.testSearch = 'partial';
  });
  await page.locator('#refreshBtn').click();
  await expect(page.locator('#lobbyRows')).toContainText('Searching for public lobbies');
  for (let batch = 0; batch < 3; batch++) await page.clock.fastForward(750);
  await page.clock.fastForward(2300);
  const rows = page.locator('#lobbyRows');
  await expect(rows).toContainText('Search incomplete');
  await expect(rows).toContainText('10/10');
  await expect(rows).toContainText('full');
  await expect(rows.getByRole('button', { name: 'JOIN' })).toHaveCount(0);

  await page.evaluate(() => {
    window.__game.net.testSearch = 'timeout';
  });
  await page.locator('#quickBtn').click();
  await expect(page.locator('#status')).toContainText('looking for an open lobby');
  for (let batch = 0; batch < 3; batch++) await page.clock.fastForward(750);
  await page.clock.fastForward(11100);
  await expect(page.locator('#status')).toContainText('public lobby search incomplete');
  const diagnostics = await page.evaluate(() => window.__game.net.getLobbyDiagnostics());
  expect(diagnostics).toMatchObject({
    signaling: 'ready',
    probes: {
      unavailable: 63,
      pending: 1,
      iceConnected: 0,
      channelsOpened: 0,
      welcomed: 0,
      refused: 0,
    },
  });
});

test('filled controls stay legible in both themes and Nerd Stats sit under the score', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/');
  const controls = page.getByRole('button', { name: 'Settings & Controls' });
  const expectContrast = async (selector) => {
    const ratio = await page.locator(selector).evaluate((element) => {
      const style = getComputedStyle(element);
      const luminance = (color) => {
        const channels = color.match(/\d+/g).map((channel) => Number(channel) / 255);
        const linear = channels.map((c) =>
          c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
        );
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      const colors = [luminance(style.color), luminance(style.backgroundColor)];
      return (Math.max(...colors) + 0.05) / (Math.min(...colors) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  };

  await expectContrast('#soloBtn');
  await expectContrast('#onlineBtn');
  await expectContrast('.mapbtn.on');
  await controls.click();
  await page.locator('#setAppearance').selectOption('dark');
  await expectContrast('.settings-nav [aria-pressed="true"]');
  await page.locator('#setNerdStats').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await expectContrast('#soloBtn');
  await expectContrast('#onlineBtn');
  await expectContrast('.mapbtn.on');
  const panelPaper = await page
    .locator('.panel')
    .evaluate((panel) => getComputedStyle(panel).backgroundColor);
  await page.locator('#onlineBtn').click();
  await expectContrast('#quickBtn');
  await page.locator('#backBtn').click();
  await page.locator('#soloBtn').click();
  const stats = page.locator('.hud-tl #nerdStats');
  await expect(stats).toHaveText(/^FPS .*PING N\/A/);
  const [line, score] = await Promise.all([
    stats.boundingBox(),
    page.locator('.score').boundingBox(),
  ]);
  expect(line.y).toBeGreaterThan(score.y);
  expect(Math.abs(line.x - score.x)).toBeLessThan(4);
  await expect(page.locator('#board')).toHaveCSS('background-color', panelPaper);
  for (const selector of ['#tip', '#bossbar', '#focusmeter', '#gstam']) {
    await expect(page.locator(selector)).toHaveCSS('mix-blend-mode', 'normal');
  }
});
