/**
 * `pan mcp connector login` and `status` (PAN-4927 W-CONN2, PAN-4950 FR-2, FR-9, D-9, D-10, D-17).
 *
 * Login runs the overdeck.ai device flow (RFC 8628) with the connector's own
 * `clientId` as `environment_id`, as the phone app does, and stores the device
 * token plus both service URLs in the connector home's `account.json`. The
 * account and directory URLs are fixed at login; every later command uses the
 * stored values. Status reads the home's records and asks a running `serve` for
 * its route through the unauthenticated `/healthz`. Neither command prints a
 * token.
 */
import { AccountClientError, getMe, platformString, pollForToken, requestDeviceCode, resolveBaseUrl } from '../../account/client.js';
import { parseDirectoryUrl } from '../../anywhere/directory-config.js';
import { ensureIdentity, readAccount, readPairing, writeAccount } from './home.js';

export interface ConnectorIo {
  out(line: string): void;
  err(line: string): void;
}

export const CONNECTOR_ACCESS_DENIED_MESSAGE =
  'This GitHub account is not on the overdeck.ai invite list, or sign-in was cancelled. Ask the operator to allow it, then run: pan mcp connector login';
export const CONNECTOR_EXPIRED_CODE_MESSAGE = 'The sign-in code expired. Run: pan mcp connector login';

const HEALTH_TIMEOUT_MS = 2_000;

function unsupportedPlatformMessage(): string {
  return `This platform (${process.platform}-${process.arch}) cannot sign in to overdeck.ai; supported: linux, darwin, win32 on x64 or arm64.`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runConnectorLogin(
  opts: { accountUrl?: string; directoryUrl?: string; home: string; env: NodeJS.ProcessEnv },
  io: ConnectorIo,
  deps: { fetch?: typeof fetch } = {},
): Promise<number> {
  let baseUrl: string;
  try {
    baseUrl = resolveBaseUrl(opts.accountUrl, opts.env);
  } catch (error) {
    io.err(error instanceof AccountClientError ? error.message : errorText(error));
    return 1;
  }
  const directory = parseDirectoryUrl(opts.directoryUrl ?? opts.env.OVERDECK_CONNECTOR_DIRECTORY_URL);
  if ('error' in directory) {
    io.err(`Invalid directory URL: ${directory.error}`);
    return 1;
  }

  const platform = platformString();
  if (platform === null) {
    io.err(unsupportedPlatformMessage());
    return 1;
  }

  let clientId: string;
  try {
    clientId = (await ensureIdentity(opts.home)).clientId;
    const existing = await readAccount(opts.home);
    if (existing) {
      io.out(`Already signed in as ${existing.githubLogin ?? 'unknown'}; signing in again replaces this connector's sign-in.`);
    }
  } catch (error) {
    io.err(errorText(error));
    return 1;
  }

  let code;
  try {
    code = await requestDeviceCode(baseUrl, { platform, environmentId: clientId }, { fetch: deps.fetch });
  } catch (error) {
    io.err(error instanceof AccountClientError ? error.message : `Cannot reach ${baseUrl}: ${errorText(error)}`);
    return 1;
  }

  io.out(`To sign in, open: ${code.verificationUri}`);
  io.out(`and enter the code: ${code.userCode}`);
  io.out(`Or open: ${code.verificationUriComplete}`);
  io.out('Waiting for approval…');

  const outcome = await pollForToken(baseUrl, code, { fetch: deps.fetch });
  if (!outcome.ok) {
    switch (outcome.reason) {
      case 'access_denied':
        io.err(CONNECTOR_ACCESS_DENIED_MESSAGE);
        break;
      case 'expired_token':
        io.err(CONNECTOR_EXPIRED_CODE_MESSAGE);
        break;
      case 'unreachable':
        io.err(`Cannot reach ${baseUrl}: ${outcome.detail}`);
        break;
      case 'failed':
        io.err(`Sign-in failed: ${outcome.detail}`);
        break;
    }
    return 1;
  }

  const me = await getMe(baseUrl, outcome.accessToken, { fetch: deps.fetch });
  const githubLogin = me.ok ? me.me.githubLogin : null;
  await writeAccount(opts.home, {
    v: 1,
    baseUrl,
    directoryUrl: directory.url,
    accessToken: outcome.accessToken,
    deviceId: outcome.deviceId,
    label: outcome.label,
    githubLogin,
    signedInAt: new Date().toISOString(),
  });
  if (!me.ok) {
    io.err(`Signed in (device ${outcome.label}), but could not read the account: ${me.kind === 'unauthorized' ? me.error : me.detail}.`);
  }
  io.out(`Signed in to ${baseUrl} as ${githubLogin ?? 'unknown'} (device ${outcome.label}).`);
  return 0;
}

async function serveRoute(port: number, doFetch: typeof fetch): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await doFetch(`http://127.0.0.1:${port}/healthz`, { signal: controller.signal });
    const body = (await res.json()) as { route?: unknown };
    return body.route === 'direct' || body.route === 'relay' || body.route === 'down' ? body.route : 'not serving';
  } catch {
    return 'not serving';
  } finally {
    clearTimeout(timer);
  }
}

export async function runConnectorStatus(
  opts: { home: string; port: number },
  io: ConnectorIo,
  deps: { fetch?: typeof fetch } = {},
): Promise<number> {
  try {
    const account = await readAccount(opts.home);
    io.out(account ? `account: ${account.githubLogin ?? 'unknown'} (${account.baseUrl})` : 'account: not signed in');
  } catch (error) {
    io.out(`account: ${errorText(error)}`);
  }
  try {
    const pairing = await readPairing(opts.home);
    io.out(pairing ? `machine: ${pairing.machineLabel} (${pairing.environmentId})` : 'machine: not paired');
    if (pairing) io.out(`scopes: ${pairing.scopes.join(', ')}`);
  } catch (error) {
    io.out(`machine: ${errorText(error)}`);
  }
  io.out(`route: ${await serveRoute(opts.port, deps.fetch ?? fetch)}`);
  return 0;
}
