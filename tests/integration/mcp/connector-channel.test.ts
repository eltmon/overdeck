/**
 * PAN-4950 WI-9 (PAN-4927 W-CONN2): a connector tool call crosses a real link channel. The
 * connector's `ConnectorLink` probes and `linkFetch` dials through an in-memory RTC dialer whose
 * other end is the real channel listener, so every request runs a real Noise IK handshake with
 * the connector's link key into a real Node HTTP server, carrying the connector bearer.
 */
import http from 'node:http';
import { createRequire } from 'node:module';
import { duplexPair } from 'node:stream';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { DirectoryMachine } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetChannelListenerForTests,
  acceptRawChannel,
  installChannelListener,
  liveChannelCount,
} from '../../../src/dashboard/server/channel-listener.js';
import { setRtcDialer } from '../../../src/lib/anywhere/channel/open.js';
import { _resetLinkClientForTests } from '../../../src/lib/anywhere/link-client.js';
import type { MachineKeyPair } from '../../../src/lib/anywhere/machine-key.js';
import { ConnectorLink, createConnectorDashboardApi } from '../../../src/lib/mcp/connector/channel-api.js';
import { connectorTools } from '../../../src/lib/mcp/connector/serve.js';
import { createOverdeckMcpServer } from '../../../src/lib/mcp/server.js';

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): MachineKeyPair };

const serverKey = dh.generateKeyPair();
const connectorKey = dh.generateKeyPair();
const serverKeyHex = serverKey.publicKey.toString('hex');
const connectorKeyHex = connectorKey.publicKey.toString('hex');

const ENV = '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9';
const CONNECTOR_TOKEN = `odk_${'d'.repeat(64)}`;

const MACHINE: DirectoryMachine = {
  environmentId: ENV,
  label: 'studio',
  publicKeyHex: serverKeyHex,
  fingerprint: 'abab-abab-abab-abab-abab',
  online: true,
  lastSeenAt: '2026-11-04T00:00:00.000Z',
  serverVersion: '0.73.1',
  endpoints: [],
};

let server: http.Server;
let pinned: boolean;
let seen: Array<{ method?: string; url?: string; authorization?: string; liveChannels: number }>;
const closers: Array<() => void> = [];
let link: ConnectorLink | null = null;

beforeEach(async () => {
  _resetChannelListenerForTests();
  pinned = true;
  seen = [];
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, liveChannels: liveChannelCount() });
    req.resume();
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.startsWith('/api/conversations')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([{ name: 'conv-1', title: 'hello' }]));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
  });
  installChannelListener(server, {
    primary: true,
    localKey: async () => serverKey,
    isPinnedPeer: (key) => pinned && key === connectorKeyHex,
    takePairing: () => 'unknown',
    onPairingFailure: () => {},
    log: () => {},
  });
  // The in-memory RTC route: each dial is one duplex pair into the real channel listener.
  setRtcDialer(async () => {
    const [a, b] = duplexPair();
    a.once('close', () => b.destroy());
    b.once('close', () => a.destroy());
    closers.push(() => a.destroy());
    void acceptRawChannel(a);
    return b;
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

afterEach(async () => {
  link?.stop();
  link = null;
  for (const close of closers.splice(0).reverse()) close();
  _resetChannelListenerForTests();
  _resetLinkClientForTests();
  setRtcDialer(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function connectorClient(): Promise<{ client: Client; link: ConnectorLink }> {
  const created = new ConnectorLink({
    pairing: {
      v: 1,
      environmentId: ENV,
      machineKeyHex: serverKeyHex,
      machineLabel: 'studio',
      token: CONNECTOR_TOKEN,
      tokenId: 'tok-1',
      scopes: ['read:state', 'read:conversations', 'tell'],
      pairedAt: '2026-11-04T00:00:00.000Z',
    },
    identity: {
      v: 1,
      clientId: '1f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9',
      linkPublicKey: connectorKeyHex,
      linkSecretKey: connectorKey.secretKey.toString('hex'),
      installPublicKey: '3'.repeat(64),
      installSecretKey: '4'.repeat(64),
    },
    rtc: { transport: { close: () => undefined }, relayRefusal: () => 'The relay needs the relay plan' },
    directory: { state: 'online', machines: [MACHINE], onStateChange: () => () => undefined },
  });
  link = created;
  await created.connect();
  const mcp = createOverdeckMcpServer(
    { api: createConnectorDashboardApi(created), scopes: ['read:state', 'read:conversations', 'tell'], isAgent: false },
    connectorTools(),
  );
  const client = new Client({ name: 'connector-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, link: created };
}

const text = (result: CallToolResult): string => result.content.map((block) => (block.type === 'text' ? block.text : '')).join('');

describe('connector tool call over a real link channel', () => {
  it('reaches GET /api/conversations with the connector bearer', async () => {
    const { client, link: created } = await connectorClient();
    expect(created.health()).toEqual({ ok: true, machine: 'studio', route: 'direct' });
    const result = (await client.callTool({ name: 'list_conversations', arguments: {} })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('conv-1');
    expect(seen).toEqual([
      { method: 'GET', url: '/api/conversations?limit=50', authorization: `Bearer ${CONNECTOR_TOKEN}`, liveChannels: expect.any(Number) },
    ]);
    expect(seen[0]?.liveChannels).toBeGreaterThanOrEqual(1);
  });

  it('fails the call and drops the route when the machine refuses the link key', async () => {
    const { client, link: created } = await connectorClient();
    pinned = false;
    const result = (await client.callTool({ name: 'list_conversations', arguments: {} })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('studio is unreachable');
    expect(created.health().route).toBe('down');
    expect(seen).toEqual([]);
  });
});
