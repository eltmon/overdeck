/**
 * PKCE sign-in to overdeck.ai (PAN-4837 FR-4, facts 3 and 4). The system browser opens
 * `/auth/start`; the account service redirects to `ai.overdeck.app:/oauth/callback`; the code is
 * exchanged with native HTTP because the account service sends no CORS headers.
 */
import { Browser } from '@capacitor/browser';
import { CapacitorHttp } from '@capacitor/core';
import type { ClientPlatform } from '@overdeck/contracts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { DeviceIdentity } from '../native/keys';
import { ACCOUNT_BASE_URL, NATIVE_REDIRECT } from './config';
import { writeAccount } from './store';
import type { AccountRecord } from './types';

export const PKCE_KEY = 'overdeck.pkce';
export const PKCE_MAX_AGE_MS = 10 * 60_000;
export const CALLBACK_PATH = '/oauth/callback';

interface PendingSignIn {
  state: string;
  verifier: string;
  createdAt: number;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

export function codeChallenge(verifier: string): string {
  return base64url(sha256(new TextEncoder().encode(verifier)));
}

/** The `/auth/start` URL for a new sign-in; stores the verifier and state. */
export function beginSignIn(identity: DeviceIdentity, platform: ClientPlatform, now = Date.now()): string {
  const verifier = base64url(randomBytes(32));
  const state = bytesToHex(randomBytes(16));
  const pending: PendingSignIn = { state, verifier, createdAt: now };
  localStorage.setItem(PKCE_KEY, JSON.stringify(pending));
  const params = new URLSearchParams({
    redirect_uri: NATIVE_REDIRECT,
    state,
    code_challenge: codeChallenge(verifier),
    code_challenge_method: 'S256',
    platform: `${platform}-arm64`,
    environment_id: identity.clientId,
  });
  return `${ACCOUNT_BASE_URL}/auth/start?${params.toString()}`;
}

/** Start a sign-in in the system browser. */
export async function startSignIn(identity: DeviceIdentity, platform: ClientPlatform): Promise<void> {
  await Browser.open({ url: beginSignIn(identity, platform) });
}

/** True for an `ai.overdeck.app:/oauth/callback` URL. */
export function isSignInCallback(url: string): boolean {
  return url.startsWith(NATIVE_REDIRECT);
}

function readPending(now: number): PendingSignIn | null {
  const raw = localStorage.getItem(PKCE_KEY);
  if (raw === null) return null;
  try {
    const pending = JSON.parse(raw) as PendingSignIn;
    if (now - pending.createdAt > PKCE_MAX_AGE_MS) {
      localStorage.removeItem(PKCE_KEY);
      return null;
    }
    return pending;
  } catch {
    localStorage.removeItem(PKCE_KEY);
    return null;
  }
}

interface TokenResponse {
  access_token?: unknown;
  device_id?: unknown;
  label?: unknown;
}

/** Finish a sign-in from the callback URL: check the state, exchange the code, store the account. */
export async function completeSignIn(callbackUrl: string, now = Date.now()): Promise<AccountRecord> {
  const url = new URL(callbackUrl);
  if (url.pathname !== CALLBACK_PATH) throw new Error('This is not a sign-in link.');
  const pending = readPending(now);
  if (!pending || url.searchParams.get('state') !== pending.state) {
    throw new Error('This sign-in did not start on this phone, or it expired. Sign in again.');
  }
  localStorage.removeItem(PKCE_KEY);
  void Browser.close().catch(() => {
    // Android has no in-app browser to close.
  });
  if (url.searchParams.get('error') !== null) {
    throw new Error(url.searchParams.get('error_description') ?? 'overdeck.ai did not complete the sign-in.');
  }
  const code = url.searchParams.get('code');
  if (code === null) throw new Error('overdeck.ai sent no sign-in code.');

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: pending.verifier,
    redirect_uri: NATIVE_REDIRECT,
  });
  const response = await CapacitorHttp.request({
    method: 'POST',
    url: `${ACCOUNT_BASE_URL}/oauth/token`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  });
  const body = (typeof response.data === 'string' ? safeJson(response.data) : response.data) as TokenResponse | null;
  if (response.status !== 200 || !body || typeof body.access_token !== 'string' || typeof body.device_id !== 'string') {
    throw new Error(`overdeck.ai refused the sign-in (HTTP ${response.status}).`);
  }
  const account: AccountRecord = {
    token: body.access_token,
    deviceId: body.device_id,
    label: typeof body.label === 'string' ? body.label : '',
  };
  await writeAccount(account);
  return account;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
