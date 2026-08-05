import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { getOverdeckHome } from './paths.js';

export const REVIEW_ATTESTATION_KEY_ENV = 'OVERDECK_REVIEW_ATTESTATION_KEY';
export const REVIEW_ATTESTATION_TOKEN_ENV = 'OVERDECK_REVIEW_ATTESTATION_TOKEN';
export const REVIEW_ATTESTATION_VERSION = 1;
export const REVIEW_ATTESTATION_RUN_SUFFIX = 'att1';

const REVIEW_ATTESTATION_KEY_FILE = 'review-attestation-key';

function keyFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env[REVIEW_ATTESTATION_KEY_ENV];
  return key && key.length >= 32 ? key : null;
}

export function reviewAttestationKeyFilePath(): string {
  return join(getOverdeckHome(), REVIEW_ATTESTATION_KEY_FILE);
}

function readPersistedKey(): string | null {
  const path = reviewAttestationKeyFilePath();
  if (!existsSync(path)) return null;
  const key = readFileSync(path, 'utf8').trim();
  if (key.length < 32) {
    throw new Error(`review attestation key file is invalid: ${path}`);
  }
  chmodSync(path, 0o600);
  return key;
}

function publishPersistedKey(key: string): string {
  const home = getOverdeckHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });

  const path = reviewAttestationKeyFilePath();
  const temporary = join(
    home,
    `.${REVIEW_ATTESTATION_KEY_FILE}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );

  try {
    writeFileSync(temporary, `${key}\n`, { mode: 0o600, flag: 'wx' });
    chmodSync(temporary, 0o600);
    try {
      // A hard link publishes the fully-written inode only when the final path
      // is absent. Concurrent dashboard boots cannot overwrite each other's key.
      linkSync(temporary, path);
      chmodSync(path, 0o600);
      return key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = readPersistedKey();
      if (!existing) throw new Error(`review attestation key disappeared during creation: ${path}`);
      if (existing !== key) {
        throw new Error(
          `review attestation key environment does not match persisted key: ${path}`,
        );
      }
      return existing;
    }
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file may not exist if its exclusive creation failed.
    }
  }
}

function createPersistedKey(): string {
  return publishPersistedKey(randomBytes(32).toString('base64url'));
}

export function ensureReviewAttestationKey(env: NodeJS.ProcessEnv = process.env): string {
  const existing = keyFromEnv(env);
  if (existing) {
    const persisted = publishPersistedKey(existing);
    env[REVIEW_ATTESTATION_KEY_ENV] = persisted;
    return persisted;
  }
  const persisted = readPersistedKey() ?? createPersistedKey();
  env[REVIEW_ATTESTATION_KEY_ENV] = persisted;
  return persisted;
}

export function hasReviewAttestationKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return keyFromEnv(env) !== null;
}

export function signReviewAttestationPayload(
  payload: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const key = keyFromEnv(env);
  return key ? createHmac('sha256', key).update(payload).digest('base64url') : null;
}

export function verifyReviewAttestationSignature(
  payload: string,
  signature: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = signReviewAttestationPayload(payload, env);
  if (!expected) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signature);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}
