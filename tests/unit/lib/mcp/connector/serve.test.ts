import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import type { DirectoryWebClient } from '@overdeck/anywhere-channel/web';
import type { DirectoryMachine } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setRtcDialer } from '../../../../../src/lib/anywhere/channel/open.js';
import type { DashboardApi, DashboardApiMethod } from '../../../../../src/lib/mcp/dashboard-api.js';
import type { ConnectorIo } from '../../../../../src/lib/mcp/connector/account.js';
import type { ConnectorRtc } from '../../../../../src/lib/mcp/connector/dial.js';
import { ensureIdentity, ensureLocalToken, writeAccount, writePairing } from '../../../../../src/lib/mcp/connector/home.js';
import type { ConnectorDeps } from '../../../../../src/lib/mcp/connector/pair.js';
import {
  connectorTools,
  runConnectorServe,
  serveConnectorStdio,
  startConnectorHttp,
} from '../../../../../src/lib/mcp/connector/serve.js';
import { ALL_TOOLS } from '../../../../../src/lib/mcp/server.js';

const LOCAL_TOKEN = `odl_${'a'.repeat(64)}`;
const ALL_SCOPES = ['read:state', 'read:conversations', 'tell', 'operate'];

function fakeApi(): DashboardApi & { calls: Array<{ method: DashboardApiMethod; path: string; body: unknown }> } {
  const calls: Array<{ method: DashboardApiMethod; path: string; body: unknown }> = [];
  return {
    calls,
    async request(method, path, body) {
      calls.push({ method, path, body });
      return { status: 200, json: [{ name: 'conv-1', title: 'hello' }] };
    },
  };
}

let close: (() => Promise<void>) | null = null;

async function start(scopes = ALL_SCOPES) {
  const api = fakeApi();
  const http = await startConnectorHttp({
    port: 0,
    localToken: LOCAL_TOKEN,
    api,
    scopes,
    health: () => ({ ok: true, machine: 'studio', route: 'direct' }),
  });
  close = http.close;
  const base = `http://127.0.0.1:${http.port}`;
  const rpc = (body: unknown, token: string | null = LOCAL_TOKEN) =>
    fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });
  return { api, http, base, rpc };
}

afterEach(async () => {
  await close?.();
  close = null;
  setRtcDialer(null);
});

describe('connectorTools', () => {
  it('drops list_machines and the start tools machine and needs arguments', () => {
    const tools = connectorTools(ALL_TOOLS);
    const names = tools.map((tool) => tool.name);
    expect(names).not.toContain('list_machines');
    expect(names).toContain('list_conversations');
    for (const name of ['start_conversation', 'start_worker', 'start_issue']) {
      const properties = tools.find((tool) => tool.name === name)?.inputSchema.properties ?? {};
      expect(properties).not.toHaveProperty('machine');
      expect(properties).not.toHaveProperty('needs');
    }
  });
});

describe('startConnectorHttp', () => {
  it('binds 127.0.0.1 and refuses a missing, wrong or different-length bearer', async () => {
    const { http, rpc } = await start();
    expect(http.host).toBe('127.0.0.1');
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    expect((await rpc(list, null)).status).toBe(401);
    expect((await rpc(list, `odl_${'b'.repeat(64)}`)).status).toBe(401);
    expect((await rpc(list, 'odl_short')).status).toBe(401);
  });

  it('lists the connector tools', async () => {
    const { rpc } = await start();
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: Array<{ name: string; inputSchema: { properties?: object } }> } };
    const names = body.result.tools.map((tool) => tool.name);
    expect(names).toContain('list_conversations');
    expect(names).not.toContain('list_machines');
    expect(body.result.tools.find((tool) => tool.name === 'start_conversation')?.inputSchema.properties).not.toHaveProperty('machine');
  });

  it('hides tools the scopes do not cover', async () => {
    const { rpc } = await start(['read:state']);
    const body = (await (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json()) as { result: { tools: Array<{ name: string }> } };
    const names = body.result.tools.map((tool) => tool.name);
    expect(names).not.toContain('send_message');
    expect(names).not.toContain('start_conversation');
  });

  it('refuses a machine argument without calling the API and forwards list_conversations', async () => {
    const { rpc, api } = await start();
    const refused = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'start_conversation', arguments: { message: 'hi', machine: 'other' } },
    });
    const refusedBody = (await refused.json()) as { result: { isError?: boolean } };
    expect(refusedBody.result.isError).toBe(true);
    expect(api.calls).toEqual([]);

    const listed = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_conversations', arguments: {} } });
    expect(listed.status).toBe(200);
    expect(api.calls).toEqual([{ method: 'GET', path: '/api/conversations?limit=50', body: undefined }]);
  });

  it('answers healthz without auth, 405 for GET /mcp, 413 for a large body and 404 elsewhere', async () => {
    const { base } = await start();
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    expect(health.headers.get('cache-control')).toBe('no-store');
    expect(await health.json()).toEqual({ ok: true, machine: 'studio', route: 'direct' });

    const get = await fetch(`${base}/mcp`);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');

    const large = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${LOCAL_TOKEN}`, 'content-type': 'application/json' },
      body: 'x'.repeat(5 * 1024 * 1024),
    });
    expect(large.status).toBe(413);

    expect((await fetch(`${base}/other`)).status).toBe(404);
  });

  it('answers a JSON-RPC parse error for a body that is not JSON', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${LOCAL_TOKEN}`, 'content-type': 'application/json' },
      body: '{nope',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32700 } });
  });
});

describe('serveConnectorStdio', () => {
  it('answers tools/list with only JSON-RPC on stdout', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const lines: string[] = [];
    stdout.on('data', (chunk: Buffer) => lines.push(...chunk.toString('utf8').split('\n').filter(Boolean)));
    const done = serveConnectorStdio({ api: fakeApi(), scopes: ALL_SCOPES, stdin, stdout });
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
    await vi.waitFor(() => expect(lines.length).toBeGreaterThan(0));
    stdin.end();
    await done;
    const messages = lines.map((line) => JSON.parse(line) as { jsonrpc: string; result?: { tools: Array<{ name: string }> } });
    expect(messages.every((message) => message.jsonrpc === '2.0')).toBe(true);
    const names = messages[0]?.result?.tools.map((tool) => tool.name) ?? [];
    expect(names).toContain('list_conversations');
    expect(names).not.toContain('list_machines');
  });
});

describe('runConnectorServe', () => {
  const ENV = '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9';
  const MACHINE: DirectoryMachine = {
    environmentId: ENV,
    label: 'studio',
    publicKeyHex: 'ab'.repeat(32),
    fingerprint: 'abab-abab-abab-abab-abab',
    online: true,
    lastSeenAt: '2026-11-04T00:00:00.000Z',
    serverVersion: '0.73.1',
    endpoints: [],
  };
  let root: string;
  let home: string;
  let blocker: Server | null = null;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'connector-serve-'));
    home = join(root, 'home');
    await writeAccount(home, {
      v: 1,
      baseUrl: 'https://account.example',
      directoryUrl: 'https://connect.example',
      accessToken: `odd_${'1'.repeat(64)}`,
      deviceId: 'dev-1',
      label: 'brave-otter',
      githubLogin: 'octo',
      signedInAt: '2026-11-04T00:00:00.000Z',
    });
    await ensureIdentity(home);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => (blocker ? blocker.close(() => resolve()) : resolve()));
    blocker = null;
    await rm(root, { recursive: true, force: true });
  });

  function recordingIo(): ConnectorIo & { lines: string[] } {
    const lines: string[] = [];
    return { lines, out: (line) => lines.push(`out: ${line}`), err: (line) => lines.push(line) };
  }

  function serveDeps(): ConnectorDeps & { waitForShutdown: () => Promise<void> } {
    const directory = {
      state: 'off',
      refusal: null,
      machines: [MACHINE],
      relayAllowed: false,
      start: async () => {
        directory.state = 'online';
      },
      stop: vi.fn(),
      onStateChange: () => () => undefined,
    };
    return {
      createDirectory: () => directory as unknown as DirectoryWebClient,
      createRtc: () => ({ dialer: vi.fn(), relayRefusal: () => 'no relay', stop: vi.fn(), transport: { close: vi.fn() } }) as unknown as ConnectorRtc,
      openPairingChannel: () => new Promise(() => undefined),
      now: () => new Date(),
      waitForShutdown: async () => undefined,
    };
  }

  const options = (port: number) => ({ home, port, stdio: false, appVersion: '0.74.0', stdin: new PassThrough(), stdout: new PassThrough() });

  it('asks for a pairing first', async () => {
    const io = recordingIo();
    expect(await runConnectorServe(options(0), io, serveDeps())).toBe(1);
    expect(io.lines.join('\n')).toContain("Pair first: pan mcp connector pair '<pairing string>'");
  });

  it('reports a port in use', async () => {
    await writePairing(home, {
      v: 1,
      environmentId: ENV,
      machineKeyHex: 'ab'.repeat(32),
      machineLabel: 'studio',
      token: `odk_${'2'.repeat(64)}`,
      tokenId: 'tok-1',
      scopes: ['read:state'],
      pairedAt: '2026-11-04T00:00:00.000Z',
    });
    await ensureLocalToken(home);
    blocker = createServer();
    await new Promise<void>((resolve) => blocker?.listen(0, '127.0.0.1', () => resolve()));
    const address = blocker.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const io = recordingIo();
    expect(await runConnectorServe(options(port), io, serveDeps())).toBe(1);
    expect(io.lines).toContain(`Port ${port} is in use; pass --port`);
    expect(io.lines.join('\n')).not.toMatch(/od[kdl]_/);
  });
});
