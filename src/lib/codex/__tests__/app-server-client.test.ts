/**
 * PAN-3835 — the async control-socket client the Codex companion adapter uses
 * as its health check. Real Unix-socket HTTP; the timeout runs on fake timers.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postCodexHostOp } from '../app-server-client.js';

let home: string;
let server: Server | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pan3835-client-'));
  mkdirSync(join(home, 'agents', 'conv-1'), { recursive: true });
  mkdirSync(join(home, 'sockets'), { recursive: true });
});

afterEach(async () => {
  vi.useRealTimers();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  rmSync(home, { recursive: true, force: true });
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<void> {
  server = createServer(handler);
  await new Promise<void>(resolve => server!.listen(join(home, 'sockets', 'appserver-conv-1.sock'), resolve));
}

describe('postCodexHostOp', () => {
  it('sends the op with the host token and returns 4xx bodies instead of throwing', async () => {
    writeFileSync(join(home, 'agents', 'conv-1', 'appserver-token'), 'secret\n');
    const seen: Array<{ token: unknown; body: string }> = [];
    await listen((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        seen.push({ token: req.headers['x-overdeck-bridge-token'], body });
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'no-thread' }));
      });
    });

    const outcome = await postCodexHostOp('conv-1', { op: 'prepare-terminal' }, { overdeckHome: home });

    expect(outcome).toEqual({ ok: true, response: { status: 409, body: { code: 'no-thread' } } });
    expect(seen).toEqual([{ token: 'secret', body: '{"op":"prepare-terminal"}' }]);
  });

  it('reports a missing token without connecting', async () => {
    expect(await postCodexHostOp('conv-1', { op: 'status' }, { overdeckHome: home })).toMatchObject({ ok: false, reason: 'token-missing' });
  });

  it('reports a host that is not listening as unreachable', async () => {
    writeFileSync(join(home, 'agents', 'conv-1', 'appserver-token'), 'secret\n');
    expect(await postCodexHostOp('conv-1', { op: 'status' }, { overdeckHome: home })).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('gives up on a host that never answers', async () => {
    writeFileSync(join(home, 'agents', 'conv-1', 'appserver-token'), 'secret\n');
    let received!: () => void;
    const requestArrived = new Promise<void>(resolve => { received = resolve; });
    await listen(() => received());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const outcome = postCodexHostOp('conv-1', { op: 'status' }, { overdeckHome: home, timeoutMs: 5_000 });
    await requestArrived;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await outcome).toMatchObject({ ok: false, reason: 'unreachable', message: expect.stringContaining('5000ms') });
  });
});
