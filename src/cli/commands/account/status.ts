/**
 * `pan account status`: report the signed-in GitHub account and this device (PRD PAN-4330 W-5, D-9).
 * Sign-in is optional (NFR-3): no token file is not an error.
 */
import { getMe, type Me } from '../../../lib/account/client.js';
import { readAccount } from '../../../lib/account/store.js';
import { type AccountIo, defaultAccountIo } from './shared.js';

export interface StatusOptions {
  json?: boolean;
}

export interface StatusDeps {
  fetch?: typeof fetch;
}

interface StatusJson {
  signedIn: boolean;
  baseUrl?: string;
  githubLogin?: string | null;
  githubId?: number | null;
  deviceId?: string;
  label?: string;
  access?: Me['access'] | null;
  reachable?: boolean;
}

function formatExpiry(expiresAt: number | null): string {
  return expiresAt === null ? 'an unknown date' : new Date(expiresAt).toISOString().slice(0, 10);
}

function accessLine(access: Me['access']): string {
  if (access.status === 'active') return 'Access:          active';
  return `Access:          expired on ${formatExpiry(access.expiresAt)}; ask the operator to renew the invite.`;
}

export async function statusCommand(options: StatusOptions, io: AccountIo = defaultAccountIo, deps: StatusDeps = {}): Promise<void> {
  let record;
  try {
    record = await readAccount();
  } catch (error) {
    io.err((error as Error).message);
    return io.exit(1);
  }

  if (!record) {
    if (options.json) io.out(JSON.stringify({ signedIn: false } satisfies StatusJson));
    else io.out('Not signed in. Run: pan account login');
    return;
  }

  const me = await getMe(record.baseUrl, record.accessToken, { fetch: deps.fetch });

  if (me.ok) {
    if (options.json) {
      io.out(JSON.stringify({
        signedIn: true,
        baseUrl: record.baseUrl,
        githubLogin: me.me.githubLogin,
        githubId: me.me.githubId,
        deviceId: record.deviceId,
        label: record.label,
        access: me.me.access,
        reachable: true,
      } satisfies StatusJson));
    } else {
      io.out(`Signed in as ${me.me.githubLogin} (GitHub id ${me.me.githubId})`);
      io.out(`Account service: ${record.baseUrl}`);
      io.out(`This device:     ${record.label} (${record.deviceId})`);
      io.out(accessLine(me.me.access));
    }
    return;
  }

  const cached: StatusJson = {
    signedIn: true,
    baseUrl: record.baseUrl,
    githubLogin: record.githubLogin,
    githubId: record.githubId,
    deviceId: record.deviceId,
    label: record.label,
    access: null,
  };

  if (me.kind === 'unauthorized') {
    if (options.json) io.out(JSON.stringify({ ...cached, reachable: true } satisfies StatusJson));
    else io.err(`This machine's sign-in is no longer valid (${me.error}). Run: pan account login`);
    return io.exit(1);
  }

  if (options.json) io.out(JSON.stringify({ ...cached, reachable: false } satisfies StatusJson));
  else io.err(`Signed in as ${record.githubLogin ?? 'unknown'} (account service unreachable: ${me.detail})`);
  return io.exit(1);
}
