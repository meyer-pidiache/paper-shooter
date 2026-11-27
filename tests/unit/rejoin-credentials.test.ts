import { expect, it } from 'vitest';
import { RejoinCredentials } from '../../src/network/rejoin-credentials.js';

it('keeps the public recovery shortcut in last-played order across credential types', () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  };
  const saved = new RejoinCredentials(storage);
  const proof = {
    hostId: 'lobby-PUB0-4',
    match: 'a'.repeat(32),
    verifier: `04${'ab'.repeat(64)}`,
    privateKey: {
      kty: 'EC',
      crv: 'P-256',
      x: 'a'.repeat(43),
      y: 'b'.repeat(43),
      d: 'c'.repeat(43),
    },
  };
  saved.saveProof('PUB0-4', proof);
  const legacy = { hostId: 'lobby-PUB1', key: 'b'.repeat(32), token: 'c'.repeat(32) };
  saved.save('PUB1', legacy);
  saved.saveProof('PUB0-4', proof);

  const reloaded = new RejoinCredentials(storage);
  expect(reloaded.getProof('PUB0')).toMatchObject(proof);
  expect(reloaded.get('PUB0')).toBeUndefined();
  expect(reloaded.latestPublicRecovery('lobby-', 16)).toMatchObject(legacy);
  reloaded.saveProof('PUB0-5', { ...proof, hostId: 'lobby-PUB0-5' });
  expect(reloaded.latestPublicRecovery('lobby-', 16)).toMatchObject({
    ...proof,
    hostId: 'lobby-PUB0-5',
  });
});
