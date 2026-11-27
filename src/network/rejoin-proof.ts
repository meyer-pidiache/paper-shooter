import { isRecord } from '../shared/ice.js';

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
const bytes = (value: string) => Uint8Array.from(value.match(/../g)!, (pair) => parseInt(pair, 16));
const curve = { name: 'ECDSA', namedCurve: 'P-256' };
const algorithm = { name: 'ECDSA', hash: 'SHA-256' };
export const MAX_REJOIN_BINDINGS = 128;

export const isRejoinVerifier = (value: unknown): value is string =>
  typeof value === 'string' && /^04[a-f0-9]{128}$/.test(value);
export const isRejoinSignature = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{128}$/.test(value);

export interface RejoinKeyPair {
  verifier: string;
  privateKey: JsonWebKey;
}

export function isRejoinKeyPair(value: unknown): value is RejoinKeyPair {
  if (!isRecord(value) || !isRejoinVerifier(value.verifier) || !isRecord(value.privateKey))
    return false;
  const { kty, crv, x, y, d } = value.privateKey;
  const coordinate = /^[A-Za-z0-9_-]{43}$/;
  return (
    kty === 'EC' &&
    crv === 'P-256' &&
    [x, y, d].every((part) => typeof part === 'string' && coordinate.test(part))
  );
}

export async function createRejoinKey(): Promise<RejoinKeyPair | undefined> {
  try {
    const { publicKey, privateKey } = await crypto.subtle.generateKey(curve, true, [
      'sign',
      'verify',
    ]);
    return {
      verifier: hex(await crypto.subtle.exportKey('raw', publicKey)),
      privateKey: await crypto.subtle.exportKey('jwk', privateKey),
    };
  } catch {
    // On platforms without Web Crypto, ordinary same-host rejoin remains available.
    return undefined;
  }
}

export interface RejoinChallenge {
  nonce: string;
  match: string;
  endpoint: string;
}

function transcript(challenge: RejoinChallenge, host: string, client: string, verifier: string) {
  return new TextEncoder().encode(
    JSON.stringify([
      'paper-shooter/rejoin/v1',
      challenge.match,
      challenge.nonce,
      challenge.endpoint,
      host,
      client,
      verifier,
    ]),
  );
}

export async function signRejoin(
  key: RejoinKeyPair,
  challenge: RejoinChallenge,
  host: string,
  client: string,
): Promise<string | undefined> {
  try {
    const privateKey = await crypto.subtle.importKey('jwk', key.privateKey, curve, false, ['sign']);
    return hex(
      await crypto.subtle.sign(
        algorithm,
        privateKey,
        transcript(challenge, host, client, key.verifier),
      ),
    );
  } catch {
    return undefined;
  }
}

export async function verifyRejoin(
  verifier: string,
  signature: unknown,
  challenge: RejoinChallenge,
  host: string,
  client: string,
): Promise<boolean> {
  if (!isRejoinVerifier(verifier) || !isRejoinSignature(signature)) return false;
  try {
    const key = await crypto.subtle.importKey('raw', bytes(verifier), curve, false, ['verify']);
    return await crypto.subtle.verify(
      algorithm,
      key,
      bytes(signature),
      transcript(challenge, host, client, verifier),
    );
  } catch {
    return false;
  }
}
