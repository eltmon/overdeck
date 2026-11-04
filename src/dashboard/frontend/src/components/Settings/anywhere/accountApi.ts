/**
 * Client for the Account card (PAN-4960): `GET /api/account` and `POST /api/account/sign-in`.
 * The view types mirror `AccountView` in src/dashboard/server/services/account-view.ts.
 */
import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport';
import { apiError, isOk, type ApiResult } from './anywhereApi';

export type AccountPlan = 'free' | 'tester';

export interface AccountSignInView {
  state: 'idle' | 'pending' | 'succeeded' | 'failed';
  /** Only for viewers who may sign in, and only while pending. */
  authorizeUrl: string | null;
  message: string | null;
}

/** Mirrors `AccountView` in src/dashboard/server/services/account-view.ts. */
export interface AccountView {
  signedIn: boolean;
  githubLogin: string | null;
  /** `<baseUrl>/account` when signed in. */
  manageUrl: string | null;
  plan: AccountPlan | null;
  tokenRejected: boolean;
  relay: { month: string; bytesUsed: number; capBytes: number; stopped: boolean } | null;
  /** The viewer is a root session from a trusted local request. */
  canSignIn: boolean;
  /** The reason account.json is unreadable. */
  accountError: string | null;
  signIn: AccountSignInView;
}

export const ACCOUNT_QUERY_KEY = ['anywhere-account'] as const;

async function readResult<T>(response: Response): Promise<ApiResult<T>> {
  const body = (await response.json().catch(() => null)) as T | { error?: string } | null;
  return { status: response.status, body };
}

export async function loadAccount(): Promise<AccountView> {
  const result = await readResult<AccountView>(await fetch('/api/account'));
  if (!isOk(result)) throw new Error(apiError(result));
  return result.body;
}

/** Start the PKCE loopback sign-in; the answer is the overdeck.ai URL to open. */
export async function startAccountSignIn(): Promise<ApiResult<{ authorizeUrl: string }>> {
  return readResult(await fetch('/api/account/sign-in', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({}),
  }));
}

export function planLabel(plan: AccountPlan | null): string {
  switch (plan) {
    case 'free':
      return 'Free account';
    case 'tester':
      return 'Tester';
    default:
      return 'Shows when overdeck.ai is reachable';
  }
}

/** The first day of the month after `YYYY-MM`, as `YYYY-MM-DD` (UTC). */
export function relayResetDate(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  // Date.UTC months are 0-based, so the 1-based month number is already the next month.
  return new Date(Date.UTC(year!, monthNumber!, 1)).toISOString().slice(0, 10);
}
