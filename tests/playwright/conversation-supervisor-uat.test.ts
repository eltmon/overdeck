import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { deliverAgentMessage } from '../../src/lib/agents.js';
import { generateLauncherScriptSync } from '../../src/lib/launcher-generator.js';
import { PTY_TOKEN_HEADER, writePtyToken } from '../../src/lib/pty-token.js';

interface UatConversation {
  name: string;
  tmuxSession: string;
  launcherPath: string;
  transcript: string[];
  bridge: NetServer;
}

let browser: Browser;
let context: BrowserContext;
let page: Page;
let httpServer: HttpServer;
let baseUrl: string;
let tmpHome: string;
let workspace: string;
let conversations: Map<string, UatConversation>;
let originalPanopticonHome: string | undefined;

function json(res: ServerResponse, body: unknown, status = 200): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readRequestBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) as Record<string, unknown> : {};
}

function readDeliveryLog(agentId: string): Array<Record<string, unknown>> {
  return readFileSync(join(tmpHome, 'logs', `bridge-${agentId}.log`), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function writeLauncher(agentId: string, channelsBridgeMcpConfig?: string): string {
  const dir = join(tmpHome, 'agents', agentId);
  mkdirSync(dir, { recursive: true });
  const launcherPath = join(dir, 'launcher.sh');
  const launcher = generateLauncherScriptSync({
    role: 'work',
    spawnMode: 'conversation',
    workingDir: workspace,
    baseCommand: 'claude --model claude-sonnet-4-6',
    sessionId: `${agentId}-session`,
    harness: 'claude-code',
    setTerminalEnv: true,
    panopticonEnv: { agentId },
    useSupervisor: true,
    supervisorScriptPath: join(process.cwd(), 'dist', 'pty-supervisor.js'),
    channelsBridgeMcpConfig,
    keepAlive: true,
  });
  writeFileSync(launcherPath, launcher, { mode: 0o755 });
  return launcherPath;
}

async function startFakeSupervisor(agentId: string, transcript: string[]): Promise<NetServer> {
  const expectedToken = await writePtyToken(agentId);
  const socketDir = join(tmpHome, 'sockets');
  mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  const socketPath = join(socketDir, `pty-${agentId}.sock`);
  return await new Promise((resolveServer) => {
    const server = createNetServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const text = buf.toString('utf8');
        const headerEnd = text.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const headerBlock = text.slice(0, headerEnd);
        const lengthMatch = /Content-Length:\s*(\d+)/i.exec(headerBlock);
        const length = lengthMatch ? Number.parseInt(lengthMatch[1], 10) : 0;
        if (text.length - (headerEnd + 4) < length) return;
        const body = text.slice(headerEnd + 4, headerEnd + 4 + length);
        const headers = Object.fromEntries(headerBlock.split('\r\n').slice(1).map((line) => {
          const idx = line.indexOf(':');
          return [line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim()];
        }));
        const parsed = JSON.parse(body) as { content?: string };
        const ok = headers[PTY_TOKEN_HEADER] === expectedToken;
        if (ok && parsed.content) transcript.push(parsed.content);
        const responseBody = ok ? 'ok' : 'forbidden';
        sock.end(
          `HTTP/1.1 ${ok ? 200 : 403} ${ok ? 'OK' : 'ERR'}\r\n` +
          `Content-Length: ${Buffer.byteLength(responseBody)}\r\n` +
          'Connection: close\r\n' +
          '\r\n' +
          responseBody,
        );
      });
    });
    server.listen(socketPath, () => resolveServer(server));
  });
}

async function createConversation(name: string, channelsBridgeMcpConfig?: string): Promise<UatConversation> {
  const tmuxSession = `conv-${name}`;
  const transcript: string[] = [];
  const bridge = await startFakeSupervisor(tmuxSession, transcript);
  const launcherPath = writeLauncher(tmuxSession, channelsBridgeMcpConfig);
  const conv: UatConversation = { name, tmuxSession, launcherPath, transcript, bridge };
  conversations.set(name, conv);
  return conv;
}

async function closeBridge(server: NetServer): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function testPageHtml(): string {
  return `<!doctype html>
<html>
  <body>
    <button id="create">New conversation</button>
    <button id="fork">Plain fork</button>
    <button id="send">Send message</button>
    <button id="sendFork">Send fork message</button>
    <button id="cleanup">Cleanup</button>
    <textarea id="message">scroll-mode delivery ping</textarea>
    <textarea id="forkMessage">plain fork delivery ping</textarea>
    <pre id="terminal" style="height: 80px; overflow: auto; border: 1px solid black; white-space: pre-wrap;">${Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n')}</pre>
    <pre id="transcript"></pre>
    <pre id="launcher"></pre>
    <script>
      let current = null;
      let fork = null;
      async function api(path, options) {
        const res = await fetch(path, options);
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
      }
      document.getElementById('create').onclick = async () => {
        current = await api('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      };
      document.getElementById('send').onclick = async () => {
        const body = JSON.stringify({ message: document.getElementById('message').value });
        const result = await api('/api/conversations/' + current.name + '/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        document.getElementById('transcript').textContent = result.transcript.join(String.fromCharCode(10));
      };
      document.getElementById('fork').onclick = async () => {
        fork = (await api('/api/conversations/' + current.name + '/summary-fork', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plain: true }) })).conversation;
        const launcher = await api('/api/conversations/' + fork.name + '/launcher');
        document.getElementById('launcher').textContent = launcher.content;
      };
      document.getElementById('sendFork').onclick = async () => {
        const body = JSON.stringify({ message: document.getElementById('forkMessage').value });
        await api('/api/conversations/' + fork.name + '/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      };
      document.getElementById('cleanup').onclick = async () => {
        if (fork) await api('/api/conversations/' + fork.name, { method: 'DELETE' });
        if (current) await api('/api/conversations/' + current.name, { method: 'DELETE' });
      };
    </script>
  </body>
</html>`;
}

async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/') {
    const html = testPageHtml();
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/conversations') {
    const conv = await createConversation('uat-parent');
    json(res, { name: conv.name, tmuxSession: conv.tmuxSession });
    return;
  }

  const messageMatch = /^\/api\/conversations\/([^/]+)\/message$/.exec(url.pathname);
  if (req.method === 'POST' && messageMatch) {
    const conv = conversations.get(decodeURIComponent(messageMatch[1]));
    if (!conv) return json(res, { error: 'missing conversation' }, 404);
    const body = await readRequestBody(req);
    await deliverAgentMessage(conv.tmuxSession, String(body.message ?? ''), 'playwright-uat');
    json(res, { transcript: conv.transcript });
    return;
  }

  const forkMatch = /^\/api\/conversations\/([^/]+)\/summary-fork$/.exec(url.pathname);
  if (req.method === 'POST' && forkMatch) {
    const parent = conversations.get(decodeURIComponent(forkMatch[1]));
    if (!parent) return json(res, { error: 'missing conversation' }, 404);
    const body = await readRequestBody(req);
    if (body.plain !== true) return json(res, { error: 'expected plain fork' }, 400);
    const fork = await createConversation('uat-plain-fork');
    json(res, { success: true, conversation: { name: fork.name, tmuxSession: fork.tmuxSession } });
    return;
  }

  const launcherMatch = /^\/api\/conversations\/([^/]+)\/launcher$/.exec(url.pathname);
  if (req.method === 'GET' && launcherMatch) {
    const conv = conversations.get(decodeURIComponent(launcherMatch[1]));
    if (!conv) return json(res, { error: 'missing conversation' }, 404);
    json(res, { content: readFileSync(conv.launcherPath, 'utf8') });
    return;
  }

  const deleteMatch = /^\/api\/conversations\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'DELETE' && deleteMatch) {
    const conv = conversations.get(decodeURIComponent(deleteMatch[1]));
    if (conv) {
      await closeBridge(conv.bridge);
      conversations.delete(conv.name);
    }
    json(res, { ok: true });
    return;
  }

  json(res, { error: 'not found' }, 404);
}

beforeEach(async () => {
  originalPanopticonHome = process.env.PANOPTICON_HOME;
  tmpHome = mkdtempSync(join(tmpdir(), 'pan-playwright-uat-'));
  workspace = mkdtempSync(join(tmpdir(), 'pan-playwright-workspace-'));
  process.env.PANOPTICON_HOME = tmpHome;
  conversations = new Map();
  httpServer = createHttpServer((req, res) => {
    handleApi(req, res).catch((error: unknown) => {
      json(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
  context = await browser.newContext();
  page = await context.newPage();
});

afterEach(async () => {
  await page?.close().catch(() => undefined);
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await Promise.all(Array.from(conversations.values()).map((conv) => closeBridge(conv.bridge).catch(() => undefined)));
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  if (originalPanopticonHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalPanopticonHome;
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('conversation supervisor Playwright UAT', () => {
  it('delivers while terminal is scrolled and keeps plain forks off Channels MCP', async () => {
    await page.goto(baseUrl);
    await page.locator('#create').click();
    await expect.poll(() => conversations.has('uat-parent')).toBe(true);

    await page.locator('#terminal').evaluate((node) => {
      node.scrollTop = 24;
      node.setAttribute('data-copy-mode', 'true');
    });
    await expect.poll(() => page.locator('#terminal').evaluate((node) => ({ scrollTop: node.scrollTop, copyMode: node.getAttribute('data-copy-mode') })))
      .toMatchObject({ scrollTop: 24, copyMode: 'true' });

    await page.locator('#send').click();
    await expect.poll(() => page.locator('#transcript').textContent()).toContain('scroll-mode delivery ping');

    await page.locator('#fork').click();
    await expect.poll(() => conversations.has('uat-plain-fork')).toBe(true);
    const launcher = page.locator('#launcher');
    await expect.poll(() => launcher.textContent()).toContain('pty-supervisor.js');
    await expect.poll(() => launcher.textContent()).not.toContain('--mcp-config');
    await expect.poll(() => launcher.textContent()).not.toContain('--dangerously-load-development-channels');

    await page.locator('#sendFork').click();
    await expect.poll(() => readDeliveryLog('conv-uat-plain-fork').at(-1)?.path).toBe('supervisor');

    await page.locator('#cleanup').click();
    await expect.poll(() => conversations.size).toBe(0);
  }, 45_000);
});
