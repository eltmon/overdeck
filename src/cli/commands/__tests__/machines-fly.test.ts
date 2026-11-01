/**
 * `pan machines add-fly` posts with node:http and no timeout (PAN-4652 WI-13).
 * A dashboard that drops the connection mid-response must not leave the
 * command waiting forever (CodeRabbit on PR #4742).
 */
import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { postWithoutTimeout } from '../machines-fly.js';

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
