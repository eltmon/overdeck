import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile as writeFileAsync } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as TmuxModule from '../../src/lib/tmux.js';

const execFileAsync = promisify(execFile);

interface SupervisorSession {
  bridge: NetServer;
  fifoPath: string;
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
let tmuxSessions: Set<string>;
let routeDispose: (() => Promise<void>) | undefined;
let originalPanopticonHome: string | undefined;
let originalHome: string | undefined;
let originalTrustedOrigins: string | undefined;
let actualTmux: typeof TmuxModule | undefined;

function pageHtml(): string {
  return `<!doctype html>
<html>
  <body>
    <button id="create">New conversation</button>
    <button id="openTerminal">Open terminal</button>
    <button id="send">Send message</button>
    <button id="fork">Plain fork</button>
    <button id="sendFork">Send fork message</button>
    <textarea id="message">scroll-mode delivery ping</textarea>
    <textarea id="forkMessage">plain fork delivery ping</textarea>
    <div id="terminalPanel" data-ready="false" style="height: 80px; overflow: auto; white-space: pre-wrap;"></div>
    <pre id="transcript"></pre>
    <pre id="launcher"></pre>
    <script>
      window.current = null;
      window.fork = null;
      window.lastError = null;
      window.terminalReady = false;
      window.terminalSocket = null;
      window.terminalText = '';
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
      function appendTerminal(data) {
        window.terminalText += data;
        const panel = document.getElementById('terminalPanel');
        panel.textContent = window.terminalText;
        panel.scrollTop = panel.scrollHeight;
      }
      document.getElementById('create').onclick = async () => {
        window.current = await api('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      };
      document.getElementById('openTerminal').onclick = async () => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(protocol + '//' + window.location.host + '/ws/terminal?session=' + encodeURIComponent(window.current.tmuxSession));
        window.terminalSocket = socket;
        socket.onopen = () => {
          socket.send(JSON.stringify({ type: 'attach', cols: 80, rows: 24 }));
        };
        socket.onmessage = (event) => {
          const data = typeof event.data === 'string' ? event.data : '';
          if (data.charCodeAt(0) === 0) {
            const control = JSON.parse(data.slice(1));
            if (control.type === 'snapshot') {
              appendTerminal(control.data || '');
              window.terminalReady = true;
              document.getElementById('terminalPanel').dataset.ready = 'true';
              socket.send(JSON.stringify({ type: 'ready' }));
            }
            return;
          }
          appendTerminal(data);
        };
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
      window.cleanupConversation = async (conversation) => {
        return await api('/api/conversations/' + conversation.name, { method: 'DELETE' });
      };
    </script>
  </body>
</html>`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
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

function removeTempDir(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

async function runTmux(args: string[]): Promise<string> {
  if (!actualTmux) throw new Error('tmux module not initialized');
  const command = actualTmux.getTmuxCommand(args);
  const { stdout } = await execFileAsync(command.command, command.args, { encoding: 'utf8' });
  return String(stdout);
}

async function tmuxSessionExists(session: string): Promise<boolean> {
  if (!actualTmux) throw new Error('tmux module not initialized');
  return Effect.runPromise(actualTmux.sessionExists(session));
}

async function captureTmuxTranscript(session: string): Promise<string> {
  if (!actualTmux) throw new Error('tmux module not initialized');
  return Effect.runPromise(actualTmux.capturePane(session, 200));
}

async function enterTmuxCopyMode(session: string): Promise<void> {
  if (!actualTmux) throw new Error('tmux module not initialized');
  const target = actualTmux.exactPaneTarget(session);
  await runTmux(['copy-mode', '-t', target]);
  await runTmux(['send-keys', '-t', target, '-X', 'page-up']);
}

async function paneInCopyMode(session: string): Promise<boolean> {
  if (!actualTmux) throw new Error('tmux module not initialized');
  const target = actualTmux.exactPaneTarget(session);
  const output = await runTmux(['display-message', '-p', '-t', target, '#{pane_in_mode}']);
  return output.trim() === '1';
}

async function createSupervisorBackedTmuxSession(agentId: string): Promise<void> {
  if (!actualTmux) throw new Error('tmux module not initialized');
  const fifoDir = join(tmpHome, 'fifos');
  mkdirSync(fifoDir, { recursive: true, mode: 0o700 });
  const fifoPath = join(fifoDir, `${agentId}.fifo`);
  rmSync(fifoPath, { force: true });
  await execFileAsync('mkfifo', [fifoPath]);
  const script = [
    `for i in $(seq 1 160); do printf 'scrollback-line-%03d\\n' "$i"; done`,
    `printf 'Claude ready\\n'`,
    `while IFS= read -r line < ${shellQuote(fifoPath)}; do printf '%s\\n' "$line"; done`,
  ].join('; ');
  await Effect.runPromise(actualTmux.createSession(agentId, workspace, `bash -lc ${shellQuote(script)}`, {
    env: { TERM: 'xterm-256color' },
    width: 80,
    height: 24,
  }));
  tmuxSessions.add(agentId);
  await startFakeSupervisor(agentId, fifoPath);
}

async function startFakeSupervisor(agentId: string, fifoPath: string): Promise<void> {
  const tokenPath = join(tmpHome, 'agents', agentId, 'pty-token');
  const expectedToken = readFileSync(tokenPath, 'utf8').trim();
  const socketDir = join(tmpHome, 'sockets');
  mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  const socketPath = join(socketDir, `pty-${agentId}.sock`);
  rmSync(socketPath, { force: true });

  const bridge = createNetServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', async (chunk) => {
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
      if (ok && parsed.content) {
        await writeFileAsync(fifoPath, `${parsed.content}\n`, 'utf8');
      }
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
  sessions.set(agentId, { bridge, fifoPath });
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

async function cleanupConversationThroughApi(conversation: { name: string }): Promise<void> {
  await page.evaluate(async (conv) => {
    await (window as any).cleanupConversation(conv);
  }, conversation);
}

async function startRealConversationRoutes(): Promise<void> {
  const { conversationsRouteLayer } = await import('../../src/dashboard/server/routes/conversations.js');
  const { setupTerminalWebSocket } = await import('../../src/dashboard/server/ws-terminal.js');
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
  setupTerminalWebSocket(httpServer);
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
  tmuxSessions = new Set();
  actualTmux = undefined;
  originalPanopticonHome = process.env.PANOPTICON_HOME;
  originalHome = process.env.HOME;
  originalTrustedOrigins = process.env.PANOPTICON_TRUSTED_ORIGINS;
  process.env.PANOPTICON_HOME = tmpHome;
  process.env.HOME = fakeHome;
  process.env.PANOPTICON_FRONTEND_DIR = workspace;

  vi.doMock('../../src/dashboard/server/event-store.js', () => ({
    getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
  }));

  vi.doMock('../../src/lib/tmux.js', async (importOriginal) => {
    const actual = await importOriginal<typeof TmuxModule>();
    actualTmux = actual;
    return {
      ...actual,
      createSessionSync: vi.fn(),
      createSession: vi.fn((session: string) => Effect.promise(async () => {
        await createSupervisorBackedTmuxSession(session);
      })),
      killSessionSync: vi.fn(),
      killSession: vi.fn((session: string) => Effect.promise(async () => {
        try {
          await Effect.runPromise(actual.killSession(session));
        } catch {
          // cleanup is idempotent when the session is already gone
        }
        const existing = sessions.get(session);
        if (existing) await closeBridge(existing.bridge);
        sessions.delete(session);
        tmuxSessions.delete(session);
      })),
      waitForClaudePrompt: vi.fn(() => Effect.succeed(Promise.resolve(true))),
    };
  });

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
  if (actualTmux) {
    await Promise.all(Array.from(tmuxSessions).map((session) => Effect.runPromise(
      actualTmux!.killSession(session).pipe(Effect.catch(() => Effect.succeed(undefined))),
    )));
  }
  tmuxSessions.clear();
  const { resetDatabase } = await import('../../src/lib/database/index.js');
  resetDatabase();
  if (originalPanopticonHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalPanopticonHome;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalTrustedOrigins === undefined) delete process.env.PANOPTICON_TRUSTED_ORIGINS;
  else process.env.PANOPTICON_TRUSTED_ORIGINS = originalTrustedOrigins;
  delete process.env.PANOPTICON_FRONTEND_DIR;
  removeTempDir(tmpHome);
  removeTempDir(fakeHome);
  removeTempDir(workspace);
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
    await expect.poll(() => tmuxSessionExists(parent.tmuxSession)).toBe(true);

    await page.locator('#openTerminal').click();
    await expect.poll(() => page.evaluate(() => (window as any).terminalReady)).toBe(true);
    await expect.poll(() => page.locator('#terminalPanel').textContent()).toContain('scrollback-line-160');

    await enterTmuxCopyMode(parent.tmuxSession);
    await expect.poll(() => paneInCopyMode(parent.tmuxSession)).toBe(true);

    await page.locator('#send').click();
    await expect.poll(() => captureTmuxTranscript(parent.tmuxSession)).toContain('scroll-mode delivery ping');
    await expect.poll(() => readDeliveryLog(parent.tmuxSession).at(-1)?.path).toBe('supervisor');

    await writeConversationSessionFile(parent);
    await page.locator('#fork').click();
    await expect.poll(() => page.evaluate(() => (window as any).fork)).not.toBeNull();
    const forkConversation = await page.evaluate(() => (window as any).fork as { name: string; tmuxSession: string });
    await expect.poll(() => sessions.has(forkConversation.tmuxSession)).toBe(true);
    await expect.poll(() => tmuxSessionExists(forkConversation.tmuxSession)).toBe(true);

    const launcher = launcherFor(forkConversation.tmuxSession);
    expect(launcher).toContain('pty-supervisor.js');
    expect(launcher).not.toContain('--mcp-config');
    expect(launcher).not.toContain('--dangerously-load-development-channels');

    await page.locator('#sendFork').click();
    await expect.poll(() => captureTmuxTranscript(forkConversation.tmuxSession)).toContain('plain fork delivery ping');
    await expect.poll(() => readDeliveryLog(forkConversation.tmuxSession).at(-1)?.path).toBe('supervisor');

    await cleanupConversationThroughApi(forkConversation);
    await cleanupConversationThroughApi(parent);

    await expect.poll(() => sessions.size).toBe(0);
    await expect.poll(() => tmuxSessionExists(parent.tmuxSession)).toBe(false);
    await expect.poll(() => tmuxSessionExists(forkConversation.tmuxSession)).toBe(false);
  }, 45_000);
});
