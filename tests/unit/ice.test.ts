import { describe, expect, it, vi } from 'vitest';
import { credentialEndpoint, parseIceServers, parseStunUrls } from '../../src/shared/ice';
import { networkConfig } from '../../src/network/config';
import { createIceClient } from '../../src/network/ice-client';

const relay = {
  urls: ['turn:relay.example:3478?transport=udp', 'turns:relay.example:443?transport=tcp'],
  username: 'user',
  credential: 'temporary',
};

describe('provider-independent ICE configuration', () => {
  it('validates STUN, TURN and endpoint inputs', () => {
    expect(parseStunUrls(' stun:mine.example:3478,stuns:other.example:5349 ')).toHaveLength(2);
    expect(parseStunUrls('')).toEqual([]);
    expect(parseIceServers([relay], 'turn')).toEqual([relay]);
    for (const value of [
      null,
      {},
      [null],
      [{ urls: [] }],
      [{ urls: 3 }],
      [{ urls: 'https://relay' }],
      [{ urls: 'stun:host', username: 3 }],
      [{ urls: 'stun:host', credential: '' }],
    ]) {
      expect(() => parseIceServers(value)).toThrow();
    }
    expect(() => parseIceServers([{ urls: 'turn:relay:3478' }], 'turn')).toThrow();
    expect(() => parseIceServers([relay], 'stun')).toThrow();
    expect(credentialEndpoint('/api/turn-credentials')).toBe('/api/turn-credentials');
    expect(credentialEndpoint('https://relay.example/credentials')).toContain('https://');
    for (const value of [
      'http://relay.example',
      '//relay.example',
      'https://user:secret@host',
      '/\\evil',
    ])
      expect(() => credentialEndpoint(value)).toThrow();
  });
  it('isolates Paper lobbies from upstream and local development and allows self-hosted signaling', () => {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]'])
      expect(networkConfig({}, hostname).namespace).toBe('papershooter-dev-');
    const configured = networkConfig(
      {
        VITE_LOBBY_NAMESPACE: 'my-game-',
        VITE_STUN_SERVERS: '',
        VITE_PEER_HOST: 'signal.example',
        VITE_PEER_PATH: '/peer',
        VITE_PEER_PORT: '9000',
        VITE_PEER_SECURE: 'false',
      },
      'localhost',
    );
    expect(configured).toMatchObject({
      namespace: 'my-game-',
      stunServers: [],
      peer: { host: 'signal.example', port: 9000, secure: false, path: '/peer' },
    });
    expect(networkConfig({ VITE_PEER_HOST: 'signal.example' }, 'localhost').peer.port).toBe(443);
    expect(() => networkConfig({ VITE_LOBBY_NAMESPACE: 'bad/path' }, 'localhost')).toThrow();
    expect(() =>
      networkConfig({ VITE_PEER_HOST: 'signal', VITE_PEER_PORT: '-1' }, 'localhost'),
    ).toThrow();
  });
  it('derives stable lobby namespaces from deployed hostnames and allows explicit sharing', () => {
    const namespace = (host: string) => networkConfig({}, host).namespace;
    const production = namespace('shooter.didaskalia.cc.cd');
    expect(namespace('SHOOTER.DIDASKALIA.CC.CD.')).toBe(production);
    expect(namespace('paper-copy.vercel.app')).not.toBe(production);
    expect(namespace('a-b.example')).not.toBe(namespace('a.b-example'));
    expect(namespace(`${'long-label.'.repeat(20)}vercel.app`)).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    const shared = { VITE_LOBBY_NAMESPACE: 'intentional-shared-' };
    expect(networkConfig(shared, 'game.example').namespace).toBe(
      networkConfig(shared, 'alias.example').namespace,
    );
  });
  it('locates static ICE configuration under the asset base and preserves explicit endpoints', () => {
    expect(networkConfig({}, 'game.example').iceConfigUrl).toBe('/ice-servers.json');
    expect(networkConfig({ BASE_URL: '/renamed-game/' }, 'owner.github.io').iceConfigUrl).toBe(
      '/renamed-game/ice-servers.json',
    );
    expect(networkConfig({ BASE_URL: './' }, 'game.example').iceConfigUrl).toBe(
      './ice-servers.json',
    );
    expect(
      networkConfig(
        {
          BASE_URL: '/renamed-game/',
          VITE_ICE_CONFIG_URL: '/api/ice-servers',
          VITE_TURN_CREDENTIALS_URL: 'https://relay.example/api/turn-credentials',
        },
        'owner.github.io',
      ),
    ).toMatchObject({
      iceConfigUrl: '/api/ice-servers',
      turnCredentialsUrl: 'https://relay.example/api/turn-credentials',
    });
  });
  it('coalesces requests and renews expiring credentials from any provider', async () => {
    let now = 0;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async (url) =>
          new Response(
            JSON.stringify(
              String(url).includes('turn')
                ? { iceServers: [relay], expiresAt: now + 120000 }
                : { iceServers: [{ urls: 'stun:mine.example:3478' }] },
            ),
          ),
      );
    const client = createIceClient(
      networkConfig({ VITE_TURN_CREDENTIALS_URL: '/api/turn' }, 'localhost'),
      { fetch: fetcher, now: () => now },
    );
    const [a, b] = await Promise.all([client.peerOptions(), client.peerOptions()]);
    expect(a.config.iceServers).toHaveLength(2);
    expect(a).toEqual(b);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await client.peerOptions();
    expect(fetcher).toHaveBeenCalledTimes(2);
    now = 70000;
    await client.peerOptions();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('keeps static play independent of the API and retries failed configuration', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    const warn = vi.fn();
    const client = createIceClient(networkConfig({}, 'localhost'), { fetch: fetcher, warn });
    expect((await client.peerOptions()).config.iceServers).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    await client.peerOptions();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const direct = createIceClient(networkConfig({ VITE_STUN_SERVERS: '' }, 'localhost'), {
      fetch: fetcher,
    });
    expect((await direct.peerOptions()).config.iceServers).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    'not-json',
    '[]',
    JSON.stringify({ iceServers: [] }),
    JSON.stringify({ iceServers: [relay], expiresAt: 0 }),
    JSON.stringify({ iceServers: [relay] }),
  ])('rejects malformed or expired credential response %s', async (body) => {
    const warn = vi.fn();
    const client = createIceClient(
      networkConfig({ VITE_STUN_SERVERS: '', VITE_TURN_CREDENTIALS_URL: '/api/turn' }, 'localhost'),
      { fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(body)), warn },
    );
    expect((await client.peerOptions()).config.iceServers).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
