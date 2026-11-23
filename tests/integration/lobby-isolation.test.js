import { afterEach, describe, expect, it, vi } from 'vitest';
import { networkConfig } from '../../src/network/config';
import { Net } from '../../src/network/peer-transport.js';
import { flushMessages, peerNetwork } from '../support/peer-network.js';

const clients = [];
afterEach(() => {
  for (const client of clients) client.leave();
  clients.length = 0;
  vi.useRealTimers();
});

function setup() {
  const { Peer } = peerNetwork();
  const client = (namespace = networkConfig({}, 'shooter.didaskalia.cc.cd').namespace) => {
    const net = new Net({ PeerClass: Peer, options: async () => ({}), namespace });
    clients.push(net);
    return net;
  };
  return { client };
}

describe('independent games sharing a signaling service', () => {
  it('keeps public slots, browsing and quick play inside each game namespace', async () => {
    vi.useFakeTimers();
    const { client } = setup();
    const paperHost = client(),
      doodleHost = client('doodledistrict-'),
      paperGuest = client(),
      doodleGuest = client('doodledistrict-');
    paperHost.hostName = 'Paper host';
    doodleHost.hostName = 'Doodle host';
    await paperHost.host({ isPublic: true });
    await doodleHost.host({ isPublic: true });
    expect([paperHost.code, doodleHost.code]).toEqual(['PUB0', 'PUB0']);
    expect(paperHost.id).not.toBe(doodleHost.id);

    const browsing = Promise.all([paperGuest.listLobbies(), doodleGuest.listLobbies()]);
    await vi.runAllTimersAsync();
    const [paperLobbies, doodleLobbies] = await browsing;
    expect(paperLobbies.map((lobby) => lobby.hostName)).toEqual(['Paper host']);
    expect(doodleLobbies.map((lobby) => lobby.hostName)).toEqual(['Doodle host']);
    expect(paperHost.conns.size).toBe(0);
    expect(doodleHost.conns.size).toBe(0);

    const joining = Promise.all([paperGuest.quickJoin(), doodleGuest.quickJoin()]);
    await vi.runAllTimersAsync();
    expect(await joining).toEqual(['PUB0', 'PUB0']);
    await flushMessages();
    expect(paperGuest.hostId).toBe(paperHost.id);
    expect(doodleGuest.hostId).toBe(doodleHost.id);
    expect(paperHost.peerIds).toEqual([paperGuest.id]);
    expect(doodleHost.peerIds).toEqual([doodleGuest.id]);
  });

  it('does not resolve another game private code and permits the same code independently', async () => {
    const { client } = setup();
    const doodleHost = client('doodledistrict-'),
      paperGuest = client(),
      paperHost = client();
    await doodleHost.host({ code: 'ABCDE' });
    await expect(paperGuest.join('ABCDE')).rejects.toThrow('no lobby');
    expect(doodleHost.conns.size).toBe(0);

    await paperHost.host({ code: 'ABCDE' });
    await paperGuest.join('ABCDE');
    expect(paperGuest.hostId).toBe(paperHost.id);
    expect(doodleHost.conns.size).toBe(0);
  });

  it('keeps two deployed copies of Paper in separate lobbies by default', async () => {
    vi.useFakeTimers();
    const { client } = setup();
    const current = client();
    const copyNamespace = networkConfig({}, 'paper-copy.vercel.app').namespace;
    const copy = client(copyNamespace);
    const guest = client(copyNamespace);
    current.hostName = 'Current site';
    copy.hostName = 'Vercel copy';
    expect(await current.host({ isPublic: true })).toBe('PUB0');
    expect(await copy.host({ isPublic: true })).toBe('PUB0');

    const browsing = guest.listLobbies();
    await vi.runAllTimersAsync();
    expect(await browsing).toMatchObject([{ code: 'PUB0', hostName: 'Vercel copy' }]);
    await copy.host({ code: 'ABCDE' });
    await expect(client().join('ABCDE')).rejects.toThrow('no lobby');
    await guest.join('ABCDE');
    expect(guest.hostId).toBe(copy.id);
  });

  it('uses an explicit deployment namespace for both discovery and hosting', async () => {
    vi.useFakeTimers();
    const { client } = setup();
    const namespace = networkConfig(
      { VITE_LOBBY_NAMESPACE: 'didaskalia-preview-' },
      'preview.example',
    ).namespace;
    const production = client(),
      preview = client(namespace),
      guest = client(namespace);
    production.hostName = 'Production';
    preview.hostName = 'Preview';
    await production.host({ isPublic: true });
    await preview.host({ isPublic: true });
    const browsing = guest.listLobbies();
    await vi.runAllTimersAsync();
    expect(await browsing).toMatchObject([{ code: 'PUB0', hostName: 'Preview' }]);
    expect(preview.id).toBe('didaskalia-preview-PUB0');
  });
});
