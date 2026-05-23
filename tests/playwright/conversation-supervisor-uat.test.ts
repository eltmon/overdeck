import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';

interface SupervisorSession {
  transcript: string[];
  bridge: NetServer;
}

let browser: Browser;
let context: BrowserContext;
let page: Page;
let httpServer: HttpServer;
let baseUrl: string;
let tmpHome: string;
let fakeHome: string;
let workspace: string;
let sessions: Map<string, SupervisorSession>;
let routeDispose: (() => Promise<void>) | undefined;
let originalPanopticonHome: string | undefined;
let originalHome: string | undefined;
let originalTrustedOrigins: string | undefined;

function pageHtml(): string {
  return `<!doctype html>
<html>
  <body>
    <button id="create">New conversation</button>
    <button id="send">Send message</button>
    <button id="fork">Plain fork</button>
    <button id="sendFork">Send fork message</button>
    <textarea id="message">scroll-mode delivery ping</textarea>
    <textarea id="forkMessage">plain fork delivery ping</textarea>
    <pre id="terminal" style="height: 80px; overflow: auto; white-space: pre-wrap;">${Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n')}</pre>
    <pre id="transcript"></pre>
    <pre id="launcher"></pre>
    <script>
      window.current = null;
      window.fork = null;
      window.lastError = null;
      async function api(path, options) {
        try {
          const res = await fetch(path, options);
          if (!res.ok) throw new Error(await res.text());
          return await res.json();
        } catch (error) {
          window.lastError = error && error.message ? error.message : String(error);
          throw error;
        }
      }
      document.getElementById('create').onclick = async () => {
        window.current = await api('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      };
      document.getElementById('send').onclick = async () => {
        const body = JSON.stringify({ message: document.getElementById('message').value });
        await api('/api/conversations/' + window.current.name + '/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        document.getElementById('transcript').textContent = 'sent';
      };
      document.getElementById('fork').onclick = async () => {
        window.fork = (await api('/api/conversations/' + window.current.name + '/summary-fork', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plain: true }) })).conversation;
      };
      document.getElementById('sendFork').onclick = async () => {
        const body = JSON.stringify({ message: document.getElementById('forkMessage').value });
        await api('/api/conversations/' + window.fork.name + '/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      };
    </script>
  </body>
</html>`;
}

async function requestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

async function closeBridge(server: NetServer): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function startFakeSupervisor(agentId: string): Promise<void> {
  const transcript: string[] = [];
  const tokenPath = join(tmpHome, 'agents', agentId, 'pty-token');
  const expectedToken = readFileSync(tokenPath, 'utf8').trim();
  const socketDir = join(tmpHome, 'sockets');
  mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  const socketPath = join(socketDir, `pty-${agentId}.sock`);
  rmSync(socketPath, { force: true });

  const bridge = createNetServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const text = buf.toString('utf8');
      const headerEnd = text.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const headerBlock = text.slice(0, headerEnd);
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(headerBlock);
      const length = lengthMatch ? Number.parseInt(lengthMatch[1], 10) : 0;
      if (Buffer.byteLength(text.slice(headerEnd + 4)) < length) return;
      const body = text.slice(headerEnd + 4, headerEnd + 4 + length);
      const headers = Object.fromEntries(headerBlock.split('\r\n').slice(1).map((line) => {
        const idx = line.indexOf(':');
        return [line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim()];
      }));
      const parsed = JSON.parse(body) as { content?: string };
      const ok = headers['x-panopticon-pty-token'] === expectedToken;
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

  await new Promise<void>((resolve) => bridge.listen(socketPath, () => {
    chmodSync(socketPath, 0o600);
    resolve();
  }));
  sessions.set(agentId, { transcript, bridge });
}

function readDeliveryLog(agentId: string): Array<Record<string, unknown>> {
  try {
    return readFileSync(join(tmpHome, 'logs', `bridge-${agentId}.log`), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function launcherFor(session: string): string {
  return readFileSync(join(fakeHome, '.panopticon', 'conversations', session, 'launcher.sh'), 'utf8');
}

async function writeConversationSessionFile(conv: { cwd: string; claudeSessionId: string }): Promise<void> {
  const { sessionFilePath } = await import('../../src/lib/paths.js');
  const sessionFile = sessionFilePath(conv.cwd, conv.claudeSessionId);
  mkdirSync(dirname(sessionFile), { recursive: true });
  writeFileSync(sessionFile, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'parent context' } })}\n`);
}

async function startRealConversationRoutes(): Promise<void> {
  const { conversationsRouteLayer } = await import('../../src/dashboard/server/routes/conversations.js');
  const routed = HttpRouter.toWebHandler(conversationsRouteLayer, { disableLogger: true });
  routeDispose = routed.dispose;
  httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method === 'GET' && req.url === '/') {
        const html = pageHtml();
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(html) });
        res.end(html);
        return;
      }
      const body = await requestBody(req);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) headers.append(key, item);
        } else if (value !== undefined) {
          headers.set(key, value);
        }
      }
      const response = await routed.handler(new Request(`http://${req.headers.host}${req.url ?? '/'}`, {
        method: req.method,
        headers,
        body: body.length > 0 ? body : undefined,
      }));
      res.writeHead(response.status, responseHeaders(response));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.PANOPTICON_TRUSTED_ORIGINS = baseUrl;
  const { _resetTrustedOriginsForTests } = await import('../../src/dashboard/server/routes/origin-validation.js');
  _resetTrustedOriginsForTests();
}

beforeEach(async () => {
  vi.resetModules();
  tmpHome = mkdtempSync(join(tmpdir(), 'pan-playwright-uat-'));
  fakeHome = mkdtempSync(join(tmpdir(), 'pan-playwright-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'pan-playwright-workspace-'));
  sessions = new Map();
  originalPanopticonHome = process.env.PANOPTICON_HOME;
  originalHome = process.env.HOME;
  originalTrustedOrigins = process.env.PANOPTICON_TRUSTED_ORIGINS;
  process.env.PANOPTICON_HOME = tmpHome;
  process.env.HOME = fakeHome;
  process.env.PANOPTICON_FRONTEND_DIR = workspace;

  vi.doMock('../../src/dashboard/server/event-store.js', () => ({
    getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
  }));

  vi.doMock('../../src/lib/tmux.js', () => ({
    createSessionSync: vi.fn(),
    createSession: vi.fn((session: string) => Effect.promise(async () => {
      await startFakeSupervisor(session);
    })),
    killSessionSync: vi.fn(),
    killSession: vi.fn((session: string) => Effect.promise(async () => {
      const existing = sessions.get(session);
      if (existing) await closeBridge(existing.bridge);
      sessions.delete(session);
    })),
    sendKeys: vi.fn(() => Effect.succeed(undefined)),
    sendRawKeystroke: vi.fn(() => Effect.succeed(undefined)),
    MessageDeliveryFailed: class MessageDeliveryFailed extends Error {},
    sessionExistsSync: vi.fn((session: string) => sessions.has(session)),
    sessionExists: vi.fn((session: string) => Effect.succeed(sessions.has(session))),
    getAgentSessionsSync: vi.fn(() => []),
    getAgentSessions: vi.fn(() => Effect.succeed([])),
    capturePaneSync: vi.fn(() => 'Claude ready'),
    capturePane: vi.fn(() => Effect.succeed('Claude ready')),
    listPaneValuesSync: vi.fn(() => []),
    listPaneValues: vi.fn(() => Effect.succeed([])),
    setOption: vi.fn(() => Effect.succeed(undefined)),
    waitForClaudePrompt: vi.fn(() => Effect.succeed(Promise.resolve(true))),
    listSessionNames: vi.fn(() => Effect.succeed(Array.from(sessions.keys()))),
  }));

  const { resetDatabase } = await import('../../src/lib/database/index.js');
  resetDatabase();
  await startRealConversationRoutes();
  browser = await chromium.launch();
  context = await browser.newContext();
  page = await context.newPage();
});

afterEach(async () => {
  await page?.close().catch(() => undefined);
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await new Promise<void>((resolve) => httpServer.close(() => resolve())).catch(() => undefined);
  await routeDispose?.().catch(() => undefined);
  await Promise.all(Array.from(sessions.values()).map((session) => closeBridge(session.bridge).catch(() => undefined)));
  sessions.clear();
  const { resetDatabase } = await import('../../src/lib/database/index.js');
  resetDatabase();
  if (originalPanopticonHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalPanopticonHome;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalTrustedOrigins === undefined) delete process.env.PANOPTICON_TRUSTED_ORIGINS;
  else process.env.PANOPTICON_TRUSTED_ORIGINS = originalTrustedOrigins;
  delete process.env.PANOPTICON_FRONTEND_DIR;
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
  vi.doUnmock('../../src/dashboard/server/event-store.js');
  vi.doUnmock('../../src/lib/tmux.js');
});

describe('conversation supervisor Playwright UAT', () => {
  it('delivers through real conversation routes and keeps plain forks off Channels MCP', async () => {
    await page.goto(baseUrl);
    await page.locator('#create').click();
    await expect.poll(async () => {
      const state = await page.evaluate(() => ({ current: (window as any).current, error: (window as any).lastError }));
      if (state.error) throw new Error(state.error);
      return state.current;
    }).not.toBeNull();
    const parent = await page.evaluate(() => (window as any).current as { name: string; tmuxSession: string; cwd: string; claudeSessionId: string });
    await expect.poll(() => sessions.has(parent.tmuxSession)).toBe(true);

    await page.locator('#terminal').evaluate((node) => { node.scrollTop = 24; });
    await expect.poll(() => page.locator('#terminal').evaluate((node) => node.scrollTop)).toBe(24);

    await page.locator('#send').click();
    await expect.poll(() => sessions.get(parent.tmuxSession)?.transcript.at(-1)).toBe('scroll-mode delivery ping');
    await expect.poll(() => readDeliveryLog(parent.tmuxSession).at(-1)?.path).toBe('supervisor');

    await writeConversationSessionFile(parent);
    await page.locator('#fork').click();
    await expect.poll(() => page.evaluate(() => (window as any).fork)).not.toBeNull();
    const forkConversation = await page.evaluate(() => (window as any).fork as { name: string; tmuxSession: string });
    await expect.poll(() => sessions.has(forkConversation.tmuxSession)).toBe(true);

    const launcher = launcherFor(forkConversation.tmuxSession);
    expect(launcher).toContain('pty-supervisor.js');
    expect(launcher).not.toContain('--mcp-config');
    expect(launcher).not.toContain('--dangerously-load-development-channels');

    await page.locator('#sendFork').click();
    await expect.poll(() => sessions.get(forkConversation.tmuxSession)?.transcript.at(-1)).toBe('plain fork delivery ping');
    await expect.poll(() => readDeliveryLog(forkConversation.tmuxSession).at(-1)?.path).toBe('supervisor');

    await closeBridge(sessions.get(parent.tmuxSession)!.bridge);
    sessions.delete(parent.tmuxSession);
    await closeBridge(sessions.get(forkConversation.tmuxSession)!.bridge);
    sessions.delete(forkConversation.tmuxSession);

    expect(sessions.size).toBe(0);
  }, 45_000);
});
