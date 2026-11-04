/**
 * `pan mcp connector pair` (PAN-4927 W-CONN2, PAN-4950 FR-3, D-12 to D-16).
 *
 * Pairing dials the machine named in the pairing string through the overdeck.ai directory
 * (direct, then relay when allowed), opens a pairing-mode secure channel keyed by the one-time
 * `odp_` code with a fresh link key, and calls `POST /api/connectors/exchange` inside it. The
 * machine binds a `connector` token to that link key. A machine whose proven static key or
 * descriptor key differs from the string's `k` is refused before anything is written. On
 * success the new link key, `pairing.json` and (when absent) `local-token` are written; the
 * local token survives a re-pair so bot configs keep working. No token is ever printed.
 *
 * `logout` (FR-9, D-18) undoes it in order, each remote step best effort: `DELETE
 * /api/connectors/self` over a link channel, `forget-client` to the directory, revoke the
 * overdeck.ai device, then delete the four home files. A failed step prints one line and never
 * stops the next; the exit code is 0 once the files are gone.
 */
import { request as httpRequest } from 'node:http';
import { hostname } from 'node:os';
import { join } from 'node:path';

import { generateStaticKeyPair } from '@overdeck/anywhere-channel';
import { revokeDevice } from '../../account/client.js';
import { clientLabel, type DirectoryWebClient } from '@overdeck/anywhere-channel/web';
import { parseConnectorPairLink } from '@overdeck/contracts';

import { channelAgent } from '../../anywhere/channel/channel-agent.js';
import type { ChannelSocket } from '../../anywhere/channel/channel-socket.js';
import { openChannel, setRtcDialer } from '../../anywhere/channel/open.js';
import type { ConnectorIo } from './account.js';
import type { linkFetch } from '../../anywhere/link-client.js';
import { ConnectorLink, createConnectorDashboardApi, noDirectPathMessage } from './channel-api.js';
import { type ConnectorRtc, createConnectorRtc } from './dial.js';
import { createConnectorDirectory, machineInDirectory, waitDirectoryOnline } from './directory.js';
import {
  type ConnectorAccount,
  type ConnectorIdentity,
  type ConnectorPairing,
  DEFAULT_CONNECTOR_PORT,
  ensureIdentity,
  ensureLocalToken,
  readAccount,
  readIdentity,
  readLocalToken,
  readPairing,
  removeConnectorFiles,
  replaceLinkKey,
  writePairing,
} from './home.js';

export const PAIR_CHANNEL_TIMEOUT_MS = 15_000;
export const EXCHANGE_TIMEOUT_MS = 15_000;
export const LOGOUT_CONNECT_TIMEOUT_MS = 15_000;
export const LOGOUT_REQUEST_TIMEOUT_MS = 5_000;

export const KEY_MISMATCH_MESSAGE = "The machine's key does not match the pairing string; ask for a new one in Connect a bot.";

export interface ConnectorDeps {
  createDirectory(input: { account: ConnectorAccount; identity: ConnectorIdentity; label: string; appVersion: string }): DirectoryWebClient;
  createRtc(directory: DirectoryWebClient): ConnectorRtc;
  /** Opens every secure channel the connector dials: the pairing channel and the link probes. */
  openPairingChannel: typeof openChannel;
  now(): Date;
  /** Logout only; tests inject them. */
  revokeDevice?: typeof revokeDevice;
  linkFetch?: typeof linkFetch;
}

export function defaultConnectorDeps(): ConnectorDeps {
  return {
    createDirectory: createConnectorDirectory,
    createRtc: (directory) => createConnectorRtc(directory),
    openPairingChannel: openChannel,
    now: () => new Date(),
  };
}

/** D-11: `--label`, else the host name, cleaned as the directory cleans it (at most 64 characters). */
export function connectorLabel(label: string | undefined, clientId: string): string {
  return clientLabel(label ?? hostname(), clientId);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One JSON POST inside a channel, with a hard deadline. */
function postOverChannel(channel: ChannelSocket, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${path} timed out after ${EXCHANGE_TIMEOUT_MS / 1000} s`)), EXCHANGE_TIMEOUT_MS);
  return new Promise<{ status: number; json: unknown }>((resolve, reject) => {
    const req = httpRequest(
      {
        method: 'POST',
        path,
        host: 'link.invalid',
        agent: channelAgent(channel),
        signal: controller.signal,
        headers: { accept: 'application/json', 'content-type': 'application/json', 'content-length': String(payload.length) },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () => {
          let json: unknown = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(payload);
  }).finally(() => clearTimeout(timer));
}

interface ExchangeAnswer {
  token: string;
  tokenId: string;
  scopes: string[];
  descriptor: { label: string; machineKey?: string };
}

function parseExchangeAnswer(json: unknown): ExchangeAnswer | null {
  if (typeof json !== 'object' || json === null) return null;
  const body = json as Record<string, unknown>;
  const descriptor = body.descriptor as Record<string, unknown> | null | undefined;
  if (typeof body.token !== 'string' || typeof body.tokenId !== 'string') return null;
  if (!Array.isArray(body.scopes) || !body.scopes.every((scope) => typeof scope === 'string')) return null;
  if (typeof descriptor !== 'object' || descriptor === null || typeof descriptor.label !== 'string') return null;
  return {
    token: body.token,
    tokenId: body.tokenId,
    scopes: body.scopes as string[],
    descriptor: { label: descriptor.label, ...(typeof descriptor.machineKey === 'string' ? { machineKey: descriptor.machineKey } : {}) },
  };
}

function exchangeRefusal(status: number, json: unknown): string {
  const body = (typeof json === 'object' && json !== null ? json : {}) as { code?: unknown; error?: unknown };
  if (status === 403 && body.code === 'not-a-connector-code') {
    return 'This pairing code was not issued for a connector, or it was already used; ask for a new one in Connect a bot.';
  }
  if (status === 403) return 'The machine refused the pairing code (it may have expired); ask for a new one in Connect a bot.';
  if (status === 409 && body.code === 'link-key-in-use') return 'This link key is already paired; run pair again.';
  return `Pairing failed: HTTP ${status} ${typeof body.error === 'string' ? body.error : ''}`.trimEnd();
}

function nextSteps(appVersion: string, home: string): string[] {
  const url = `http://127.0.0.1:${DEFAULT_CONNECTOR_PORT}/mcp`;
  return [
    `Start the connector:  npx -y @overdeck/core@${appVersion} mcp connector serve`,
    'Give your bot the local token (never paste it into chat):',
    `  export OVERDECK_CONNECTOR_LOCAL_TOKEN="$(cat "${join(home, 'local-token')}")"`,
    `Hermes:     mcp_servers.overdeck.url = ${url}, header Authorization: Bearer \${OVERDECK_CONNECTOR_LOCAL_TOKEN}`,
    `OpenClaw:   mcp.servers.overdeck = { url: "${url}", transport: "streamable-http" } with the same header`,
    `Grok Build: npx -y @overdeck/core@${appVersion} mcp connector serve --stdio`,
  ];
}

export async function runConnectorPair(
  opts: { pairingString: string; label?: string; home: string; appVersion: string },
  io: ConnectorIo,
  deps: ConnectorDeps = defaultConnectorDeps(),
): Promise<number> {
  const link = parseConnectorPairLink(opts.pairingString);
  if (!link) {
    io.err('That is not an Overdeck connector pairing string; copy it again from Connect a bot.');
    return 1;
  }

  let account: ConnectorAccount | null;
  let identity: ConnectorIdentity;
  try {
    account = await readAccount(opts.home);
    if (!account) {
      io.err('Sign in first: pan mcp connector login');
      return 1;
    }
    identity = await ensureIdentity(opts.home);
  } catch (error) {
    io.err(errorText(error));
    return 1;
  }

  const label = connectorLabel(opts.label, identity.clientId);
  const directory = deps.createDirectory({ account, identity, label, appVersion: opts.appVersion });
  let rtc: ConnectorRtc | null = null;
  let channel: ChannelSocket | null = null;
  try {
    await directory.start();
    await waitDirectoryOnline(directory);
    const found = machineInDirectory(directory, link.environmentId);
    if (!found.ok) {
      io.err(found.error);
      return 1;
    }
    rtc = deps.createRtc(directory);
    setRtcDialer(rtc.dialer);

    const linkKey = generateStaticKeyPair();
    const pairingOpts = { mode: 'pairing' as const, pairingCode: link.code, localKey: linkKey, timeoutMs: PAIR_CHANNEL_TIMEOUT_MS };
    try {
      channel = await deps.openPairingChannel(`rtc://${link.environmentId}`, pairingOpts);
    } catch (directError) {
      if (rtc.relayRefusal() !== null) {
        io.err(noDirectPathMessage(found.machine.label));
        return 1;
      }
      try {
        channel = await deps.openPairingChannel(`rtc+turn://${link.environmentId}`, pairingOpts);
      } catch (relayError) {
        io.err(`Could not reach ${found.machine.label}: ${errorText(relayError)} (direct: ${errorText(directError)})`);
        return 1;
      }
    }

    // D-16: the handshake proved the machine's static key; it must be the one in the string.
    if (channel.channel.remoteKeyHex !== link.machineKeyHex) {
      io.err(KEY_MISMATCH_MESSAGE);
      return 1;
    }

    const answer = await postOverChannel(channel, '/api/connectors/exchange', { v: 1, clientId: identity.clientId, label });
    if (answer.status !== 200) {
      io.err(exchangeRefusal(answer.status, answer.json));
      return 1;
    }
    const exchanged = parseExchangeAnswer(answer.json);
    if (!exchanged) {
      io.err('Pairing failed: the machine sent an unexpected answer');
      return 1;
    }
    if (exchanged.descriptor.machineKey !== link.machineKeyHex) {
      io.err(KEY_MISMATCH_MESSAGE);
      return 1;
    }

    await replaceLinkKey(opts.home, identity, linkKey);
    await writePairing(opts.home, {
      v: 1,
      environmentId: link.environmentId,
      machineKeyHex: link.machineKeyHex,
      machineLabel: exchanged.descriptor.label,
      token: exchanged.token,
      tokenId: exchanged.tokenId,
      scopes: exchanged.scopes,
      pairedAt: deps.now().toISOString(),
    });
    await ensureLocalToken(opts.home);

    io.out(`Paired with ${exchanged.descriptor.label} (${link.environmentId}) with scopes ${exchanged.scopes.join(', ')}.`);
    for (const line of nextSteps(opts.appVersion, opts.home)) io.out(line);
    return 0;
  } catch (error) {
    io.err(errorText(error));
    return 1;
  } finally {
    channel?.destroy();
    setRtcDialer(null);
    rtc?.stop();
    directory.stop();
  }
}

/** Resolves with the promise's value, or with `fallback` after `ms`. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A record that cannot be read is treated as absent: logout deletes it anyway. */
async function readOrNull<T>(read: () => Promise<T | null>, io: ConnectorIo): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    io.err(errorText(error));
    return null;
  }
}

/** The machine closes the caller's channel as it revokes, so a reset after sending counts as done. */
function droppedAfterSend(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ECONNRESET' || code === 'EPIPE' || (error instanceof Error && error.message === 'socket hang up');
}

async function removeFromMachine(
  input: { pairing: ConnectorPairing; identity: ConnectorIdentity; directory: DirectoryWebClient },
  deps: ConnectorDeps,
): Promise<string | null> {
  const { pairing, identity, directory } = input;
  if (directory.state !== 'online') return 'the overdeck.ai directory is not reachable';
  const found = machineInDirectory(directory, pairing.environmentId);
  if (!found.ok) return found.error;
  const rtc = deps.createRtc(directory);
  setRtcDialer(rtc.dialer);
  const link = new ConnectorLink({ pairing, identity, rtc, directory, openProbe: deps.openPairingChannel });
  try {
    await within(link.connect(), LOGOUT_CONNECT_TIMEOUT_MS, undefined);
    if (!link.health().ok) return link.lastError() ?? 'no route to the machine';
    const api = createConnectorDashboardApi(link, deps.linkFetch ? { linkFetch: deps.linkFetch } : {});
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOGOUT_REQUEST_TIMEOUT_MS);
    try {
      const answer = await api.request('DELETE', '/api/connectors/self', undefined, { signal: controller.signal });
      if (answer.status === 200) return null;
      const error = (answer.json as { error?: unknown } | null)?.error;
      return `HTTP ${answer.status}${typeof error === 'string' ? ` ${error}` : ''}`;
    } catch (error) {
      if (droppedAfterSend(error)) return null;
      return controller.signal.aborted ? `no answer within ${LOGOUT_REQUEST_TIMEOUT_MS / 1000} s` : errorText(error);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    link.stop();
    setRtcDialer(null);
    rtc.stop();
  }
}

export async function runConnectorLogout(
  opts: { home: string; label?: string; appVersion: string },
  io: ConnectorIo,
  deps: ConnectorDeps = defaultConnectorDeps(),
): Promise<number> {
  const pairing = await readOrNull(() => readPairing(opts.home), io);
  const account = await readOrNull(() => readAccount(opts.home), io);
  const identity = await readOrNull(() => readIdentity(opts.home), io);
  const localToken = await readOrNull(() => readLocalToken(opts.home), io);
  if (!pairing && !account && !identity && !localToken) {
    await removeConnectorFiles(opts.home);
    io.out('Not signed in.');
    return 0;
  }

  let directory: DirectoryWebClient | null = null;
  try {
    if (account && identity) {
      directory = deps.createDirectory({ account, identity, label: connectorLabel(opts.label, identity.clientId), appVersion: opts.appVersion });
      try {
        await directory.start();
        await waitDirectoryOnline(directory);
      } catch (error) {
        io.err(`Could not reach the overdeck.ai directory: ${errorText(error)}`);
      }
    }

    if (pairing) {
      const reason =
        directory && identity ? await removeFromMachine({ pairing, identity, directory }, deps).catch(errorText) : 'not signed in to overdeck.ai';
      if (reason === null) io.out(`Removed this connector from ${pairing.machineLabel}.`);
      else io.err(`Could not reach ${pairing.machineLabel} (${reason}); remove the connector there in Settings → Anywhere → Bots.`);
    }

    if (directory?.state === 'online') directory.send({ type: 'forget-client' });

    if (account) {
      const revoke = deps.revokeDevice ?? revokeDevice;
      const outcome = await within(
        revoke(account.baseUrl, account.accessToken, account.deviceId).catch((error: unknown) => ({ ok: false as const, detail: errorText(error) })),
        LOGOUT_REQUEST_TIMEOUT_MS,
        { ok: false as const, detail: `no answer within ${LOGOUT_REQUEST_TIMEOUT_MS / 1000} s` },
      );
      if (!outcome.ok) io.err(`Could not revoke this device at ${account.baseUrl} (${outcome.detail}).`);
    }
  } finally {
    directory?.stop();
  }

  await removeConnectorFiles(opts.home);
  io.out(`Signed out; deleted ${opts.home} files.`);
  return 0;
}
