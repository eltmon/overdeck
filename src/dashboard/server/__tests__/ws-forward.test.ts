/**
 * PAN-4650 WI-17: /ws/forward pipes a linked machine's operator to a local dev
 * port and refuses Overdeck's ports, agents, fenced links and plain callers.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { MACHINE_TOKEN_SCOPES } from '../../../lib/access-tokens.js';
import type { ProjectConfig } from '../../../lib/projects.js';
import type { ChannelMarker } from '../channel-peer.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';
import { listPreviewPorts } from '../routes/conversation-preview-ports.js';
import { setupForwardWebSocket, type ForwardWebSocketDeps } from '../ws-forward.js';

const LINK: ChannelMarker = { mode: 'link', remoteKeyHex: 'ab'.repeat(32), pairingId: null };
const REFUSED = new Set([3010, 3011, 3012, 80, 443, 8080]);

const closers: Array<() => Promise<void> | void> = [];
const sockets: WebSocket[] = [];

function machine(actor: 'operator' | { agentId: string } = 'operator'): DashboardCredential {
  return { kind: 'machine', tokenId: 't', environmentId: 'env-laptop', scopes: MACHINE_TOKEN_SCOPES('operator'), actor, access: 'operator' };
}

function listen<T extends Server | TcpServer>(server: T): Promise<number> {
  closers.push(() => new Promise((resolve) => { (server as Server).closeAllConnections?.(); server.close(() => resolve()); }));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

async function owner(deps: Partial<ForwardWebSocketDeps>): Promise<number> {
  const server = createHttpServer();
  setupForwardWebSocket(server, {
    channelOf: () => LINK,
    authorize: () => ({ ok: true, credential: machine() }),
    refusedPorts: async () => REFUSED,
    ...deps,
  });
  return listen(server);
}

function open(port: number, target: number): WebSocket {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/forward?port=${target}`);
  ws.on('error', () => undefined);
  sockets.push(ws);
  return ws;
}

function refusal(ws: WebSocket): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => ws.on('unexpected-response', (_req, res) => {
    let body = '';
    res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
  }));
}

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const close of closers.splice(0).reverse()) await close();
});

describe('/ws/forward (PAN-4650 WI-17)', () => {
  it('ac1: refuses Overdeck ports and out-of-range ports with 403 port-refused', async () => {
    const port = await owner({});
    for (const target of [3011, 3012, 80, 443, 8080, 80000]) {
      const { status, body } = await refusal(open(port, target));
      expect(status, String(target)).toBe(403);
      expect(JSON.parse(body)).toMatchObject({ code: 'port-refused' });
    }
  });

  it('ac2: pipes bytes to 127.0.0.1:<port> and back', async () => {
    const echo = createTcpServer((socket) => socket.on('data', (data) => socket.write(`echo:${data.toString()}`)));
    const echoPort = await listen(echo);
    const port = await owner({});
    const ws = open(port, echoPort);
    await new Promise((resolve) => ws.once('open', resolve));
    const reply = new Promise<string>((resolve) => ws.once('message', (data) => resolve(data.toString())));
    ws.send('GET / HTTP/1.1');
    expect(await reply).toBe('echo:GET / HTTP/1.1');
  });

  it('ac3: refuses an agent actor with agent-fenced and a link without the forward scope', async () => {
    const agent = await owner({ authorize: () => ({ ok: true, credential: machine({ agentId: 'agent-pan-1' }) }) });
    const fenced = await refusal(open(agent, 5173));
    expect(fenced.status).toBe(403);
    expect(JSON.parse(fenced.body)).toMatchObject({ code: 'agent-fenced' });

    const noScope = await owner({ authorize: () => ({ ok: false, status: 403, message: 'Forbidden: missing scope forward' }) });
    expect((await refusal(open(noScope, 5173))).status).toBe(403);
  });

  it('ac4: refuses a caller that is not on a secure channel', async () => {
    const port = await owner({ channelOf: () => null });
    expect((await refusal(open(port, 5173))).status).toBe(403);
  });
});

describe('preview ports (PAN-4650 D-4650-17)', () => {
  it("ac5: lists the workspace's assigned ports and the project's service ports", async () => {
    const root = await mkdtemp(join(tmpdir(), 'pan-4650-ports-'));
    closers.push(() => rm(root, { recursive: true, force: true }));
    const cwd = join(root, 'workspaces', 'feature-pan-4650', 'src');
    await mkdir(cwd, { recursive: true });
    await writeFile(join(root, '.frontend-ports'), 'feature-pan-4649:5173\nfeature-pan-4650:5174\n');
    await writeFile(join(root, '.api-ports'), 'feature-pan-4650:8081\n');
    const config = { name: 'app', path: root, workspace: { services: [{ name: 'docs', path: 'docs', start_command: 'x', port: 3000 }] } } as unknown as ProjectConfig;

    expect(await listPreviewPorts(cwd, [{ key: 'app', config }])).toEqual([
      { port: 3000, label: 'docs' },
      { port: 5174, label: 'frontend' },
      { port: 8081, label: 'api' },
    ]);
    expect(await listPreviewPorts(root, [{ key: 'app', config }])).toEqual([{ port: 3000, label: 'docs' }]);
    expect(await listPreviewPorts('/nowhere', [{ key: 'app', config }])).toEqual([]);
  });
});
