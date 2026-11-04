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
 */
import { request as httpRequest } from 'node:http';
import { hostname } from 'node:os';
import { join } from 'node:path';

import { generateStaticKeyPair } from '@overdeck/anywhere-channel';
import { clientLabel, type DirectoryWebClient } from '@overdeck/anywhere-channel/web';
import { parseConnectorPairLink } from '@overdeck/contracts';

import { channelAgent } from '../../anywhere/channel/channel-agent.js';
import type { ChannelSocket } from '../../anywhere/channel/channel-socket.js';
import { openChannel, setRtcDialer } from '../../anywhere/channel/open.js';
import type { ConnectorIo } from './account.js';
import { noDirectPathMessage } from './channel-api.js';
import { type ConnectorRtc, createConnectorRtc } from './dial.js';
import { createConnectorDirectory, machineInDirectory, waitDirectoryOnline } from './directory.js';
import {
  type ConnectorAccount,
  type ConnectorIdentity,
  DEFAULT_CONNECTOR_PORT,
  ensureIdentity,
  ensureLocalToken,
  readAccount,
  replaceLinkKey,
  writePairing,
} from './home.js';

export const PAIR_CHANNEL_TIMEOUT_MS = 15_000;
export const EXCHANGE_TIMEOUT_MS = 15_000;

export const KEY_MISMATCH_MESSAGE = "The machine's key does not match the pairing string; ask for a new one in Connect a bot.";

export interface ConnectorDeps {
  createDirectory(input: { account: ConnectorAccount; identity: ConnectorIdentity; label: string; appVersion: string }): DirectoryWebClient;
  createRtc(directory: DirectoryWebClient): ConnectorRtc;
  openPairingChannel: typeof openChannel;
  now(): Date;
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
