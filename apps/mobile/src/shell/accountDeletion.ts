/**
 * Phone account deletion (PRD PAN-5107 WI-2; FR-4, FR-5, FR-6, FR-7, FR-9).
 *
 * requestAccountDeletion calls `DELETE /v1/account` with the device token; deleteAccount maps the
 * answer to a signed-out notice, then runs the normal sign-out cleanup with `account: null` so the
 * revoke-device step is skipped (the server has already revoked every device of a deleted account).
 * The notice is carried in sessionStorage because the cleanup clears localStorage and reloads.
 */
import { Browser } from '@capacitor/browser';
import { CapacitorHttp } from '@capacitor/core';

import { ACCOUNT_BASE_URL } from './config';
import { signOut, type SignOutDeps } from './signOut';
import type { AccountRecord } from './types';

export const DELETE_ACCOUNT_TIMEOUT_MS = 15_000;
export const SIGNED_OUT_NOTICE_KEY = 'overdeck.signedOutNotice';

export type SignedOutNotice = 'deletion-requested' | 'finish-on-web';
export type DeletionAnswer = 'requested' | 'token-gone';
export type DeleteAccountResult = { ok: true } | { ok: false; message: string };

export interface DeleteAccountDeps {
  account: AccountRecord;
  cleanup: SignOutDeps;
  request?: (account: AccountRecord) => Promise<DeletionAnswer>;
  setNotice?: (notice: SignedOutNotice) => void;
}

interface ErrorBody {
  error?: unknown;
}

/** The server's error code from a response body that may be a parsed object or a raw JSON string; unreadable bodies carry no code. */
function errorCode(data: unknown): unknown {
  if (typeof data === 'string') {
    try {
      return (JSON.parse(data) as ErrorBody).error;
    } catch {
      return undefined;
    }
  }
  if (data && typeof data === 'object') return (data as ErrorBody).error;
  return undefined;
}

/** `DELETE /v1/account` on overdeck.ai with the device token. */
export async function requestAccountDeletion(account: AccountRecord): Promise<DeletionAnswer> {
  const response = await CapacitorHttp.request({
    method: 'DELETE',
    url: `${ACCOUNT_BASE_URL}/v1/account`,
    headers: { Authorization: `Bearer ${account.token}` },
    connectTimeout: DELETE_ACCOUNT_TIMEOUT_MS,
    readTimeout: DELETE_ACCOUNT_TIMEOUT_MS,
  });
  if (response.status === 202) return 'requested';
  if (response.status === 401 && errorCode(response.data) === 'account_deleted') return 'requested';
  if (response.status === 401 || response.status === 403) return 'token-gone';
  throw new Error(`overdeck.ai answered HTTP ${response.status}.`);
}

export function writeSignedOutNotice(notice: SignedOutNotice): void {
  try {
    sessionStorage.setItem(SIGNED_OUT_NOTICE_KEY, notice);
  } catch {
    // Best effort; the user already saw the outcome from the deletion that just ran.
  }
}

export function readSignedOutNotice(): SignedOutNotice | null {
  try {
    const value = sessionStorage.getItem(SIGNED_OUT_NOTICE_KEY);
    return value === 'deletion-requested' || value === 'finish-on-web' ? value : null;
  } catch {
    return null;
  }
}

export function clearSignedOutNotice(): void {
  try {
    sessionStorage.removeItem(SIGNED_OUT_NOTICE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Opens the account page on overdeck.ai in the system browser. */
export function openAccountPage(): Promise<void> {
  return Browser.open({ url: `${ACCOUNT_BASE_URL}/account` });
}

export async function deleteAccount(deps: DeleteAccountDeps): Promise<DeleteAccountResult> {
  const request = deps.request ?? requestAccountDeletion;
  const setNotice = deps.setNotice ?? writeSignedOutNotice;
  let answer: DeletionAnswer;
  try {
    answer = await request(deps.account);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  setNotice(answer === 'requested' ? 'deletion-requested' : 'finish-on-web');
  await signOut({ ...deps.cleanup, account: null });
  return { ok: true };
}
