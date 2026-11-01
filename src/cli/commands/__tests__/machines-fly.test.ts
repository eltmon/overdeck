/**
 * `pan machines add-fly` posts with node:http and no timeout (PAN-4652 WI-13).
 * A dashboard that drops the connection mid-response must not leave the
 * command waiting forever (CodeRabbit on PR #4742). `--harness` reaches the
 * request body and the output says whether Codex is ready (PAN-4296 WI-6).
 */
import { createServer, type Server } from 'node:http';

import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { postWithoutTimeout, registerMachinesFlyCommands } from '../machines-fly.js';

const dashboard = vi.hoisted(() => ({ url: '' }));
vi.mock('../../../lib/config.js', () => ({ getDashboardApiUrl: () => dashboard.url }));
vi.mock('../../../lib/internal-token.js', () => ({ ensureInternalToken: () => 'test-token', INTERNAL_TOKEN_HEADER: 'x-overdeck-internal-token' }));

let server: Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
}

describe('postWithoutTimeout', () => {
  it('returns the status and JSON body of a complete answer', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ record: { label: 'fly-m1' } }));
    });
    expect(await postWithoutTimeout(base, '/api/machines/fly', {})).toEqual({ status: 201, json: { record: { label: 'fly-m1' } } });
  });

  it('resolves as unreachable when the connection closes after the headers', async () => {
    const base = await serve((req, res) => {
      res.writeHead(201, { 'content-type': 'application/json', 'content-length': '1000' });
      res.write('{"rec', () => req.socket.destroy());
    });
    expect(await postWithoutTimeout(base, '/api/machines/fly', {})).toMatchObject({ unreachable: expect.any(String) });
  });

  it('resolves as unreachable when nothing listens', async () => {
    const base = await serve(() => undefined);
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
    expect(await postWithoutTimeout(base, '/api/machines/fly', {})).toMatchObject({ unreachable: expect.any(String) });
  });
});

describe('pan machines add-fly --harness (PAN-4296 WI-6)', () => {
  it('sends harness and model, and prints codex: yes for a record with a Codex sign-in path', async () => {
    let received: unknown = null;
    dashboard.url = await serve((req, res) => {
      let text = '';
      req.on('data', (chunk: Buffer) => { text += chunk.toString(); });
      req.on('end', () => {
        received = JSON.parse(text);
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          link: { label: 'fly-m1' },
          record: { label: 'fly-m1', region: 'iad', docker: true, appName: 'overdeck-ws', codexAuthPath: '/.codex/auth.json' },
        }));
      });
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = new Command().exitOverride();
    registerMachinesFlyCommands(program.command('machines'));
    await program.parseAsync(['machines', 'add-fly', '--project', 'overdeck', '--harness', 'codex', '--model', 'gpt-6.1-sol', '--message', 'hi'], { from: 'user' });

    expect(received).toEqual({ projectKey: 'overdeck', message: 'hi', harness: 'codex', model: 'gpt-6.1-sol' });
    expect(log).toHaveBeenCalledWith('Linked fly-m1 (Fly app overdeck-ws, region iad; docker: yes; codex: yes)');
    log.mockRestore();
  });

  it('sends no harness key without --harness, and prints codex: no for a record without a Codex sign-in path', async () => {
    let received: Record<string, unknown> = {};
    dashboard.url = await serve((req, res) => {
      let text = '';
      req.on('data', (chunk: Buffer) => { text += chunk.toString(); });
      req.on('end', () => {
        received = JSON.parse(text) as Record<string, unknown>;
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          link: { label: 'fly-m1' },
          record: { label: 'fly-m1', region: 'iad', docker: false, appName: 'overdeck-ws', codexAuthPath: null },
        }));
      });
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const program = new Command().exitOverride();
    registerMachinesFlyCommands(program.command('machines'));
    await program.parseAsync(['machines', 'add-fly', '--project', 'overdeck'], { from: 'user' });

    expect(received).toEqual({ projectKey: 'overdeck' });
    expect('harness' in received).toBe(false);
    expect(log).toHaveBeenCalledWith('Linked fly-m1 (Fly app overdeck-ws, region iad; docker: no; codex: no)');
    log.mockRestore();
  });
});
