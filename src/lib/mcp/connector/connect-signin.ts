/**
 * Resumable overdeck.ai sign-in for `pan mcp connector connect` (PAN-5069 FR-3, FR-9).
 *
 * Most bot shells show a command's output only after it exits, so a fresh run never waits for
 * approval: it requests a device code, saves it to `pending-signin.json`, prints the activate
 * link and returns `authorize` at once. A later run with a live pending sign-in polls that same
 * device code for up to `waitSeconds`; approved writes `account.json` (the record `login`
 * writes) and removes the pending file. The device code itself is never printed.
 */
import {
  AccountClientError,
  getMe,
  platformString,
  pollForToken,
  requestDeviceCode,
  resolveBaseUrl,
} from '../../account/client.js';
import { parseDirectoryUrl } from '../../anywhere/directory-config.js';
import type { ConnectorIo } from './account.js';
import { AUTHORIZE_NEXT, type ConnectStatus, failureStatus } from './connect-output.js';
import {
  type ConnectorAccount,
  type ConnectorPendingSignIn,
  ensureIdentity,
  readAccount,
  readPendingSignIn,
  removePendingSignIn,
  writeAccount,
  writePendingSignIn,
} from './home.js';

export type SignInResult = { ok: true; account: ConnectorAccount } | { ok: false; status: ConnectStatus };

export interface SignInOptions {
  home: string;
  env: NodeJS.ProcessEnv;
  accountUrl?: string;
  directoryUrl?: string;
  /** The bot's name, shown on the activate page as a claim. */
  clientName?: string;
  /** The machine's name, shown on the activate page as a claim. */
  targetName?: string;
  /** How long a run with a live pending sign-in polls for approval; 0 never polls. */
  waitSeconds: number;
}

export interface SignInDeps {
  fetch?: typeof fetch;
  /** Milliseconds since the epoch. */
  now?: () => number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function authorize(pending: ConnectorPendingSignIn, io: ConnectorIo): SignInResult {
  io.out(`Open this link and click Authorize: ${pending.verificationUriComplete}`);
  return { ok: false, status: { v: 1, status: 'authorize', url: pending.verificationUriComplete, expiresAt: pending.expiresAt, next: AUTHORIZE_NEXT } };
}

function failure(status: ConnectStatus): SignInResult {
  return { ok: false, status };
}

/** Poll a live pending sign-in for up to `waitSeconds`; `'request-new'` when its grant expired. */
async function resumePendingSignIn(
  opts: SignInOptions & { baseUrl: string; directoryUrl: string; pending: ConnectorPendingSignIn },
  io: ConnectorIo,
  deps: SignInDeps,
  now: () => number,
): Promise<SignInResult | 'request-new'> {
  const { baseUrl, pending } = opts;
  if (opts.waitSeconds === 0) return authorize(pending, io);
  const secondsLeft = Math.floor((Date.parse(pending.expiresAt) - now()) / 1000);
  let outcome;
  try {
    outcome = await pollForToken(
      baseUrl,
      {
        deviceCode: pending.deviceCode,
        userCode: pending.userCode,
        verificationUri: pending.verificationUriComplete,
        verificationUriComplete: pending.verificationUriComplete,
        interval: pending.interval,
        // The budget as expiresIn makes pollForToken stop at it.
        expiresIn: Math.min(opts.waitSeconds, secondsLeft),
      },
      { fetch: deps.fetch },
    );
  } catch (error) {
    return failure(failureStatus('network', errorText(error)));
  }

  try {
    if (outcome.ok) {
      const me = await getMe(baseUrl, outcome.accessToken, { fetch: deps.fetch });
      const account: ConnectorAccount = {
        v: 1,
        baseUrl,
        directoryUrl: opts.directoryUrl,
        accessToken: outcome.accessToken,
        deviceId: outcome.deviceId,
        label: outcome.label,
        githubLogin: me.ok ? me.me.githubLogin : null,
        signedInAt: new Date(now()).toISOString(),
      };
      await writeAccount(opts.home, account);
      await removePendingSignIn(opts.home);
      io.out(`Signed in to ${baseUrl} as ${account.githubLogin ?? 'unknown'} (device ${account.label}).`);
      return { ok: true, account };
    }
    switch (outcome.reason) {
      case 'access_denied':
        await removePendingSignIn(opts.home);
        return failure(failureStatus('signin-denied'));
      case 'expired_token':
        // `detail === 'expired_token'` is the server's answer; anything else is the local budget.
        if (outcome.detail !== 'expired_token' && Date.parse(pending.expiresAt) > now()) return authorize(pending, io);
        await removePendingSignIn(opts.home);
        return 'request-new';
      case 'unreachable':
      case 'failed': {
        // A concurrent run may have finished the grant.
        const account = await readAccount(opts.home);
        if (account) return { ok: true, account };
        return failure(failureStatus('network', outcome.detail));
      }
    }
  } catch (error) {
    return failure(failureStatus('home-unreadable', errorText(error)));
  }
}

/** Sign in when needed: returns the account, or the status line this run ends with. */
export async function ensureSignedIn(opts: SignInOptions, io: ConnectorIo, deps: SignInDeps = {}): Promise<SignInResult> {
  const now = deps.now ?? Date.now;
  try {
    const existing = await readAccount(opts.home);
    if (existing) return { ok: true, account: existing };
  } catch (error) {
    return failure(failureStatus('home-unreadable', errorText(error)));
  }

  let baseUrl: string;
  try {
    baseUrl = resolveBaseUrl(opts.accountUrl, opts.env);
  } catch (error) {
    return failure(failureStatus('network', errorText(error)));
  }
  const directory = parseDirectoryUrl(opts.directoryUrl ?? opts.env.OVERDECK_CONNECTOR_DIRECTORY_URL);
  if ('error' in directory) return failure(failureStatus('network', `Invalid directory URL: ${directory.error}`));
  const platform = platformString();
  if (platform === null) return failure(failureStatus('unsupported-platform', `${process.platform}-${process.arch}`));

  let clientId: string;
  let pending: ConnectorPendingSignIn | null;
  try {
    clientId = (await ensureIdentity(opts.home)).clientId;
    pending = await readPendingSignIn(opts.home);
  } catch (error) {
    return failure(failureStatus('home-unreadable', errorText(error)));
  }

  if (pending && pending.baseUrl === baseUrl && Date.parse(pending.expiresAt) > now()) {
    const resumed = await resumePendingSignIn({ ...opts, baseUrl, directoryUrl: directory.url, pending }, io, deps, now);
    if (resumed !== 'request-new') return resumed;
  }

  let code;
  try {
    code = await requestDeviceCode(
      baseUrl,
      { platform, environmentId: clientId, clientName: opts.clientName, targetName: opts.targetName },
      { fetch: deps.fetch },
    );
  } catch (error) {
    return failure(failureStatus('network', error instanceof AccountClientError ? error.message : `Cannot reach ${baseUrl}: ${errorText(error)}`));
  }
  const fresh: ConnectorPendingSignIn = {
    v: 1,
    baseUrl,
    directoryUrl: directory.url,
    deviceCode: code.deviceCode,
    userCode: code.userCode,
    verificationUriComplete: code.verificationUriComplete,
    interval: code.interval,
    expiresAt: new Date(now() + code.expiresIn * 1000).toISOString(),
  };
  try {
    await writePendingSignIn(opts.home, fresh);
  } catch (error) {
    return failure(failureStatus('home-unreadable', errorText(error)));
  }
  return authorize(fresh, io);
}
