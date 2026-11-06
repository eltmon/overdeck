/**
 * `pan mcp connector connect` (PAN-5069 FR-1 to FR-7, NFR-1, NFR-4).
 *
 * One command a bot runs, and reruns, until it prints `ready`: sign in (resumable, see
 * `connect-signin.ts`), pair with the code in the pairing string unless this home is already
 * paired with that machine, verify the route with `GET /api/connectors/self`, and print the MCP
 * registration. Every run ends with exactly one status line (`connect-output.ts`) as the last
 * line of stdout. An existing pairing is reused when it still verifies; it is replaced with the
 * code when the machine refuses it (HTTP 401/403, or the link handshake refused with
 * `unknown-peer`/`identity-refused`, which is what a removed connector sees). At most one pairing
 * per run: a code is single use. Nothing here prints a token, and nothing reads `~/.overdeck`.
 */
import { parseConnectorPairLink } from '@overdeck/contracts';

import { setRtcDialer } from '../../anywhere/channel/open.js';
import type { ConnectorIo } from './account.js';
import { ConnectorLink, createConnectorDashboardApi } from './channel-api.js';
import {
  type ConnectPlatform,
  type ConnectStatus,
  exitCodeFor,
  failureStatus,
  formatStatusLine,
  READY_NEXT,
  registrationFor,
  registrationLines,
} from './connect-output.js';
import { ensureSignedIn } from './connect-signin.js';
import { machineInDirectory, waitDirectoryOnline } from './directory.js';
import { type ConnectorAccount, type ConnectorPairing, readIdentity, readPairing } from './home.js';
import { connectorLabel, type ConnectorDeps, defaultConnectorDeps, pairWithMachine, within } from './pair.js';

export const VERIFY_CONNECT_TIMEOUT_MS = 30_000;
export const VERIFY_REQUEST_TIMEOUT_MS = 15_000;

export interface ConnectOptions {
  pairingString: string;
  /** The bot's name: the sign-in page claim and the label the directory and machine show. */
  name?: string;
  platform: ConnectPlatform;
  waitSeconds: number;
  accountUrl?: string;
  directoryUrl?: string;
  home: string;
  env: NodeJS.ProcessEnv;
  appVersion: string;
}

export type ConnectDeps = ConnectorDeps & {
  fetch?: typeof fetch;
  /** Milliseconds since the epoch, for the sign-in. */
  nowMs?: () => number;
  /** Tests inject it. */
  pairWithMachine?: typeof pairWithMachine;
};

type Verified =
  | { ok: true; machine: string; environmentId: string; scopes: string[]; route: 'direct' | 'relay' }
  | { ok: false; repair: true; detail: string }
  | { ok: false; repair: false; status: ConnectStatus };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stopped(status: ConnectStatus): Verified {
  return { ok: false, repair: false, status };
}

function parseSelf(json: unknown): { scopes: string[]; machine: { environmentId: string; label: string } } | null {
  if (typeof json !== 'object' || json === null) return null;
  const body = json as Record<string, unknown>;
  const machine = body.machine as Record<string, unknown> | null | undefined;
  if (!Array.isArray(body.scopes) || !body.scopes.every((scope) => typeof scope === 'string')) return null;
  if (typeof machine !== 'object' || machine === null) return null;
  if (typeof machine.environmentId !== 'string' || typeof machine.label !== 'string') return null;
  return { scopes: body.scopes as string[], machine: { environmentId: machine.environmentId, label: machine.label } };
}

/** Open a link to the paired machine and ask it who this connector is. */
async function verify(
  input: { account: ConnectorAccount; pairing: ConnectorPairing; home: string; name?: string; appVersion: string },
  deps: ConnectDeps,
): Promise<Verified> {
  let identity;
  try {
    identity = await readIdentity(input.home);
  } catch (error) {
    return stopped(failureStatus('home-unreadable', errorText(error)));
  }
  if (!identity) return stopped(failureStatus('home-unreadable', `identity.json is missing from ${input.home}`));

  const { pairing } = input;
  const directory = deps.createDirectory({
    account: input.account,
    identity,
    label: connectorLabel(input.name, identity.clientId),
    appVersion: input.appVersion,
  });
  let rtc: ReturnType<ConnectorDeps['createRtc']> | null = null;
  let link: ConnectorLink | null = null;
  try {
    try {
      await directory.start();
      await waitDirectoryOnline(directory);
    } catch (error) {
      return stopped(failureStatus(directory.state === 'refused' ? 'directory-refused' : 'network', errorText(error)));
    }
    // The link never probes a machine the directory shows offline, so classify that first.
    const found = machineInDirectory(directory, pairing.environmentId);
    if (!found.ok) {
      const listed = directory.machines.some((machine) => machine.environmentId === pairing.environmentId);
      return stopped(failureStatus(listed ? 'machine-offline' : 'machine-not-in-account', found.error));
    }

    rtc = deps.createRtc(directory);
    setRtcDialer(rtc.dialer);
    link = new ConnectorLink({ pairing, identity, rtc, directory, openProbe: deps.openPairingChannel });
    await within(link.connect(), VERIFY_CONNECT_TIMEOUT_MS, undefined);
    const health = link.health();
    if (!health.ok || health.route === 'down') {
      const code = link.lastErrorCode();
      const detail = link.lastError() ?? `no route to ${pairing.machineLabel}`;
      if (code === 'unknown-peer' || code === 'identity-refused') return { ok: false, repair: true, detail };
      if (rtc.relayRefusal() !== null) return stopped(failureStatus('relay-plan-needed', detail));
      return stopped(failureStatus('verify-failed', detail));
    }

    const api = createConnectorDashboardApi(link, deps.linkFetch ? { linkFetch: deps.linkFetch } : {});
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_REQUEST_TIMEOUT_MS);
    let answer;
    try {
      answer = await api.request('GET', '/api/connectors/self', undefined, { signal: controller.signal });
    } catch (error) {
      const detail = controller.signal.aborted ? `no answer within ${VERIFY_REQUEST_TIMEOUT_MS / 1000} s` : errorText(error);
      return stopped(failureStatus('verify-failed', detail));
    } finally {
      clearTimeout(timer);
    }
    const self = answer.status === 200 ? parseSelf(answer.json) : null;
    if (answer.status === 401 || answer.status === 403) {
      const error = (answer.json as { error?: unknown } | null)?.error;
      return { ok: false, repair: true, detail: `HTTP ${answer.status}${typeof error === 'string' ? ` ${error}` : ''}` };
    }
    if (!self) return stopped(failureStatus('verify-failed', `GET /api/connectors/self answered HTTP ${answer.status}`));
    return { ok: true, machine: self.machine.label, environmentId: self.machine.environmentId, scopes: self.scopes, route: health.route };
  } finally {
    link?.stop();
    setRtcDialer(null);
    rtc?.stop();
    directory.stop();
  }
}

async function readPairingFor(home: string, environmentId: string, machineKeyHex: string): Promise<ConnectorPairing | null> {
  const pairing = await readPairing(home);
  return pairing && pairing.environmentId === environmentId && pairing.machineKeyHex === machineKeyHex ? pairing : null;
}

async function connect(opts: ConnectOptions, io: ConnectorIo, deps: ConnectDeps): Promise<ConnectStatus> {
  const link = parseConnectorPairLink(opts.pairingString);
  if (!link) return failureStatus('bad-pairing-string');

  const signedIn = await ensureSignedIn(
    {
      home: opts.home,
      env: opts.env,
      accountUrl: opts.accountUrl,
      directoryUrl: opts.directoryUrl,
      clientName: opts.name,
      targetName: link.machineLabel,
      waitSeconds: opts.waitSeconds,
    },
    io,
    { fetch: deps.fetch, now: deps.nowMs },
  );
  if (!signedIn.ok) return signedIn.status;
  const verifyWith = (pairing: ConnectorPairing) =>
    verify({ account: signedIn.account, pairing, home: opts.home, name: opts.name, appVersion: opts.appVersion }, deps);

  let existing: ConnectorPairing | null;
  try {
    existing = await readPairingFor(opts.home, link.environmentId, link.machineKeyHex);
  } catch (error) {
    return failureStatus('home-unreadable', errorText(error));
  }
  let verified: Verified | null = null;
  if (existing) {
    verified = await verifyWith(existing);
    if (!verified.ok && !verified.repair) return verified.status;
    if (!verified.ok) io.out(`The machine no longer accepts this connector (${verified.detail}); pairing again with the code.`);
  }

  if (!verified?.ok) {
    io.out('Pairing with the machine…');
    const paired = await (deps.pairWithMachine ?? pairWithMachine)(
      { pairingString: opts.pairingString, label: opts.name, home: opts.home, appVersion: opts.appVersion },
      deps,
    );
    if (!paired.ok) return failureStatus(paired.code === 'not-signed-in' ? 'pairing-failed' : paired.code, paired.message);
    let pairing: ConnectorPairing | null;
    try {
      pairing = await readPairingFor(opts.home, link.environmentId, link.machineKeyHex);
    } catch (error) {
      return failureStatus('home-unreadable', errorText(error));
    }
    if (!pairing) return failureStatus('pairing-failed', `pairing.json in ${opts.home} does not name the paired machine`);
    verified = await verifyWith(pairing);
    // The code is spent: a fresh pairing the machine refuses is not paired again in this run.
    if (!verified.ok) return verified.repair ? failureStatus('pairing-failed', verified.detail) : verified.status;
  }

  io.out(`Connected to ${verified.machine} over ${verified.route} with ${verified.scopes.join(', ')}.`);
  const registration = registrationFor({ version: opts.appVersion, env: opts.env });
  for (const line of registrationLines(opts.platform, registration)) io.out(line);
  return {
    v: 1,
    status: 'ready',
    machine: verified.machine,
    environmentId: verified.environmentId,
    route: verified.route,
    scopes: verified.scopes,
    registration,
    next: READY_NEXT,
  };
}

/** Run every stage that is not done yet; the last stdout line is the status line. Returns its exit code. */
export async function runConnectorConnect(opts: ConnectOptions, io: ConnectorIo, deps: ConnectDeps = defaultConnectorDeps()): Promise<number> {
  let status: ConnectStatus;
  try {
    status = await connect(opts, io, deps);
  } catch (error) {
    status = failureStatus('pairing-failed', errorText(error));
  }
  io.out(formatStatusLine(status));
  return exitCodeFor(status);
}
