/**
 * `pan account login`: the RFC 8628 device flow against the overdeck.ai account service
 * (PRD PAN-4330 W-4, D-1, D-4, D-7, D-8). Sign-in is optional (NFR-3); pan join (PAN-4480)
 * runs this flow when the machine is not signed in.
 */
import { AccountClientError, getMe, platformString, pollForToken, requestDeviceCode, resolveBaseUrl } from '../../../lib/account/client.js';
import { readAccount, writeAccount } from '../../../lib/account/store.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { type AccountIo, defaultAccountIo } from './shared.js';

export const ACCESS_DENIED_MESSAGE =
  'This GitHub account is not on the overdeck.ai invite list, or sign-in was cancelled. Ask the operator to allow it, then run: pan account login';
export const EXPIRED_CODE_MESSAGE = 'The sign-in code expired. Run: pan account login';

export interface LoginOptions {
  baseUrl?: string;
}

export interface LoginDeps {
  fetch?: typeof fetch;
}

function unsupportedPlatformMessage(): string {
  return `This platform (${process.platform}-${process.arch}) cannot sign in to overdeck.ai; supported: linux, darwin, win32 on x64 or arm64.`;
}

/** D-7: an existing token file is replaced in place, never merged. */
function alreadySignedInMessage(login: string | null): string {
  return `Already signed in as ${login ?? 'unknown'}; signing in again replaces this machine's token.`;
}

export async function loginCommand(options: LoginOptions, io: AccountIo = defaultAccountIo, deps: LoginDeps = {}): Promise<void> {
  let baseUrl: string;
  try {
    baseUrl = resolveBaseUrl(options.baseUrl, process.env);
  } catch (error) {
    io.err(error instanceof AccountClientError ? error.message : String(error));
    return io.exit(1);
  }

  const platform = platformString();
  if (platform === null) {
    io.err(unsupportedPlatformMessage());
    return io.exit(1);
  }

  let environmentId: string;
  try {
    environmentId = (await ensureEnvironmentIdentity()).environmentId;
  } catch (error) {
    io.err((error as Error).message);
    return io.exit(1);
  }

  try {
    const existing = await readAccount();
    if (existing) io.out(alreadySignedInMessage(existing.githubLogin));
  } catch (error) {
    io.err((error as Error).message);
    return io.exit(1);
  }

  let code;
  try {
    code = await requestDeviceCode(baseUrl, { platform, environmentId }, { fetch: deps.fetch });
  } catch (error) {
    io.err(error instanceof AccountClientError ? error.message : `Cannot reach ${baseUrl}: ${(error as Error).message}`);
    return io.exit(1);
  }

  io.out(`To sign in, open: ${code.verificationUri}`);
  io.out(`and enter the code: ${code.userCode}`);
  io.out(`Or open: ${code.verificationUriComplete}`);
  io.out('Waiting for approval…');

  const outcome = await pollForToken(baseUrl, code, { fetch: deps.fetch });
  if (!outcome.ok) {
    switch (outcome.reason) {
      case 'access_denied':
        io.err(ACCESS_DENIED_MESSAGE);
        break;
      case 'expired_token':
        io.err(EXPIRED_CODE_MESSAGE);
        break;
      case 'unreachable':
        io.err(`Cannot reach ${baseUrl}: ${outcome.detail}`);
        break;
      case 'failed':
        io.err(`Sign-in failed: ${outcome.detail}`);
        break;
    }
    return io.exit(1);
  }

  const me = await getMe(baseUrl, outcome.accessToken, { fetch: deps.fetch });
  const signedInAt = new Date().toISOString();

  if (!me.ok) {
    await writeAccount({
      v: 1,
      baseUrl,
      accessToken: outcome.accessToken,
      deviceId: outcome.deviceId,
      label: outcome.label,
      githubLogin: null,
      githubId: null,
      signedInAt,
    });
    const reason = me.kind === 'unauthorized' ? me.error : me.detail;
    io.err(`Signed in (device ${outcome.label}, ${outcome.deviceId}), but could not read the account: ${reason}. Run: pan account status`);
    return io.exit(1);
  }

  await writeAccount({
    v: 1,
    baseUrl,
    accessToken: outcome.accessToken,
    deviceId: outcome.deviceId,
    label: outcome.label,
    githubLogin: me.me.githubLogin,
    githubId: me.me.githubId,
    signedInAt,
  });
  io.out(`Signed in to ${baseUrl} as ${me.me.githubLogin} (device ${outcome.label}, ${outcome.deviceId}).`);
}
