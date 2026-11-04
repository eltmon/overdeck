/**
 * Protected Tailscale Serve HTTPS (PAN-1254 W-5, FR-6, D-2, D-12, NFR-5, C-4).
 *
 * `enableTailscaleServe()` is the one idempotent operation behind both the
 * `serve` and `protect` setup steps. In order it:
 *
 *   1. reads fresh Tailscale state and refuses unless the backend is
 *      `Running`, MagicDNS and HTTPS certificates are on, nothing else is
 *      served on 443, 443 is not on Funnel, and the CLI is 1.52 or later;
 *   2. turns on `dashboard.require_token_mint` (D-2) — before Serve exists,
 *      and left on if anything later fails, because Serve makes every
 *      tailnet visitor a loopback peer;
 *   3. trusts `https://<MagicDNS name>` as an origin (D-12);
 *   4. runs `tailscale serve --bg --https=443 http://127.0.0.1:<port>` unless
 *      Serve already proxies this dashboard (`--bg` persists it in tailscaled);
 *   5. checks that `https://<MagicDNS name>/api/environment` answers with this
 *      machine's environment id (skipped in userspace mode, which has no TUN
 *      route to its own tailnet address).
 *
 * It never replaces another Serve handler and never turns Serve off (NFR-5).
 * The caller passes the origins the server already trusts and invalidates its
 * trusted-origins cache afterwards; `src/lib` never imports server code.
 */
import { ensureEnvironmentIdentity } from '../environment-identity.js';
import { addSavedTrustedOrigin, type AddOriginResult } from '../remote-access/trusted-origins.js';
import { saveRequireTokenMint } from '../settings-api.js';
import { runTailscale, TAILSCALE_WRITE_TIMEOUT_MS, type TailscaleCli, type TailscaleRunResult } from './cli.js';
import { ACCESS_DENIED_PATTERN } from './login.js';
import { invalidateTailscaleStateCache, readTailscaleState, type TailscaleState } from './state.js';

export const TAILSCALE_ADMIN_DNS_URL = 'https://login.tailscale.com/admin/dns';
export const SERVE_SELF_CHECK_TIMEOUT_MS = 15_000;
/** The modern `serve --bg --https=443 <target>` syntax arrived in 1.52 (C-4). */
export const MIN_SERVE_VERSION: readonly [number, number] = [1, 52];

export type ServeFailureReason =
  | 'not-running'
  | 'https-disabled'
  | 'foreign-handler'
  | 'old-version'
  | 'access-denied'
  | 'serve-failed'
  | 'self-check-failed'
  | 'userspace-serve-unsupported';

export type ServeResult =
  | { ok: true; url: string; selfCheck: 'passed' | 'skipped-userspace'; changed: boolean }
  | { ok: false; reason: ServeFailureReason; message: string; adminUrl?: string };

export interface ServeDeps {
  /** Origins the server already trusts (the route passes `getTrustedOrigins()`). */
  alreadyTrusted?: readonly string[];
  readState?: () => Promise<TailscaleState>;
  run?: (cli: TailscaleCli, args: string[]) => Promise<TailscaleRunResult>;
  saveRequireTokenMint?: () => Promise<void>;
  addTrustedOrigin?: (origin: string, alreadyTrusted: readonly string[]) => Promise<AddOriginResult>;
  fetch?: typeof fetch;
  selfEnvironmentId?: () => Promise<string>;
}

/** True when `version` (e.g. `1.104.4`) is below 1.52. Unknown versions pass. */
export function isOldServeVersion(version: string | null): boolean {
  const match = version?.match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major < MIN_SERVE_VERSION[0] || (major === MIN_SERVE_VERSION[0] && minor < MIN_SERVE_VERSION[1]);
}

function firstLine(text: string): string | null {
  return text.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? null;
}

async function freshState(): Promise<TailscaleState> {
  invalidateTailscaleStateCache();
  return readTailscaleState();
}

async function selfCheck(
  url: string,
  fetchImpl: typeof fetch,
  selfEnvironmentId: () => Promise<string>,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVE_SELF_CHECK_TIMEOUT_MS);
  try {
    const [response, expected] = await Promise.all([
      fetchImpl(`${url}/api/environment`, { signal: controller.signal, headers: { accept: 'application/json' } }),
      selfEnvironmentId(),
    ]);
    if (!response.ok) return `${url}/api/environment answered ${response.status}.`;
    const body = await response.json() as { environmentId?: unknown };
    if (body.environmentId !== expected) return `${url} answered, but not with this machine's environment id.`;
    return null;
  } catch (error) {
    if (controller.signal.aborted) return `${url} did not answer within ${SERVE_SELF_CHECK_TIMEOUT_MS / 1000} s.`;
    return `${url} did not answer: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timer);
  }
}

/** Turn on protected Serve HTTPS for this dashboard. Idempotent; never throws for a Tailscale failure. */
export async function enableTailscaleServe(deps: ServeDeps = {}): Promise<ServeResult> {
  const state = await (deps.readState ?? freshState)();
  const cli = state.cli;
  if (!cli || state.backendState !== 'Running') {
    return { ok: false, reason: 'not-running', message: 'Tailscale is not signed in and running on this machine.' };
  }
  if (!state.magicDnsName || !state.magicDnsEnabled || !state.httpsEnabled) {
    return {
      ok: false,
      reason: 'https-disabled',
      message: 'Turn on MagicDNS and HTTPS certificates for your tailnet, then try again.',
      adminUrl: TAILSCALE_ADMIN_DNS_URL,
    };
  }
  if (state.serve.otherHandlerOn443 && !state.serve.proxiesDashboard) {
    return {
      ok: false,
      reason: 'foreign-handler',
      message: 'Tailscale Serve already serves something else on port 443. Overdeck will not replace it; see `tailscale serve status`.',
    };
  }
  if (state.serve.funnelOn443) {
    return {
      ok: false,
      reason: 'foreign-handler',
      message: 'Tailscale Funnel publishes port 443 of this machine on the public internet. Overdeck will not serve the dashboard there; turn Funnel off for 443 first.',
    };
  }
  if (isOldServeVersion(state.version)) {
    return { ok: false, reason: 'old-version', message: 'Update Tailscale to 1.52 or later.' };
  }

  const url = `https://${state.magicDnsName}`;
  // D-2: token sign-in first, and left on whatever happens next.
  await (deps.saveRequireTokenMint ?? saveRequireTokenMint)();
  const added = await (deps.addTrustedOrigin ?? addSavedTrustedOrigin)(url, deps.alreadyTrusted ?? []);
  if (!added.ok) {
    return { ok: false, reason: 'serve-failed', message: `Could not trust ${url} as an origin (${added.reason}).` };
  }

  let changed = false;
  if (!state.serve.proxiesDashboard) {
    const run = deps.run ?? ((c: TailscaleCli, args: string[]) => runTailscale(c, args, { timeoutMs: TAILSCALE_WRITE_TIMEOUT_MS }));
    const result = await run(cli, ['serve', '--bg', '--https=443', `http://127.0.0.1:${state.port}`]);
    invalidateTailscaleStateCache();
    if (!result.ok) {
      const output = `${result.stderr}\n${result.stdout}`;
      if (ACCESS_DENIED_PATTERN.test(output)) {
        return { ok: false, reason: 'access-denied', message: firstLine(output) ?? 'Access denied.' };
      }
      // A tailnet without Serve enabled prints an admin link and waits for it.
      const enableLink = output.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0];
      if (enableLink) {
        return { ok: false, reason: 'https-disabled', message: 'Enable Serve for your tailnet, then try again.', adminUrl: enableLink };
      }
      const detail = result.timedOut ? 'timed out' : (firstLine(output) ?? `exited with code ${result.code}`);
      return { ok: false, reason: 'serve-failed', message: `tailscale serve failed: ${detail}` };
    }
    changed = true;
  }

  if (cli.mode === 'userspace') return { ok: true, url, selfCheck: 'skipped-userspace', changed };
  const failure = await selfCheck(
    url,
    deps.fetch ?? fetch,
    deps.selfEnvironmentId ?? (async () => (await ensureEnvironmentIdentity()).environmentId),
  );
  if (failure) return { ok: false, reason: 'self-check-failed', message: failure };
  return { ok: true, url, selfCheck: 'passed', changed };
}
