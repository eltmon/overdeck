import { fork, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { INTERNAL_TOKEN_HEADER } from '../../../src/lib/internal-token.js';

const request = {
  kind: 'strike' as const,
  markerHead: 'abc123',
  workspacePath: '/repo/workspaces/feature-pan-2811-strike',
  branchName: 'strike/pan-2811',
  recoveryTarget: 'strike-pan-2811',
};

let server: Server | undefined;
let child: ChildProcess | undefined;

afterEach(async () => {
  child?.kill('SIGTERM');
  child = undefined;
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe('Deacon strike transport fork boundary', () => {
  it('lets a forked child submit to the dashboard parent without module registration', async () => {
    const received = new Promise<{ url: string; token: string | undefined; origin: string | undefined; body: unknown }>((resolve) => {
      server = createServer((incoming, response) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        incoming.on('end', () => {
          resolve({
            url: incoming.url ?? '',
            token: incoming.headers[INTERNAL_TOKEN_HEADER] as string | undefined,
            origin: incoming.headers.origin,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          });
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ success: true, mergeStatus: 'merging' }));
        });
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port');
    const dashboardUrl = `http://127.0.0.1:${address.port}`;

    child = fork(join(process.cwd(), 'tests/fixtures/deacon-strike-transport-child.mjs'), [], {
      execArgv: ['--import', 'tsx'],
      env: {
        ...process.env,
        OVERDECK_INTERNAL_DASHBOARD_URL: dashboardUrl,
        OVERDECK_INTERNAL_TOKEN: 'fork-shared-token',
      },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });

    const result = new Promise<unknown>((resolve, reject) => {
      child!.once('message', resolve);
      child!.once('error', reject);
      child!.once('exit', (code) => {
        if (code && code !== 0) reject(new Error(`forked child exited ${code}`));
      });
    });
    child.send({ issueId: 'PAN-2811', request });

    await expect(result).resolves.toEqual({ success: true, mergeStatus: 'merging' });
    await expect(received).resolves.toEqual({
      url: '/api/internal/strikes/PAN-2811/merge',
      token: 'fork-shared-token',
      origin: dashboardUrl,
      body: request,
    });
  });
});
