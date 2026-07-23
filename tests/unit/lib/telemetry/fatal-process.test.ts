import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  brotliDecompressSync,
  gunzipSync,
  inflateSync,
} from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

const fixture = join(
  import.meta.dirname,
  '../../../fixtures/telemetry-fatal-child.ts',
);
const tempDirs: string[] = [];

function decodeBody(request: IncomingMessage, body: Buffer): string {
  switch (request.headers['content-encoding']) {
    case 'br': return brotliDecompressSync(body).toString('utf8');
    case 'deflate': return inflateSync(body).toString('utf8');
    case 'gzip': return gunzipSync(body).toString('utf8');
    default: return body.toString('utf8');
  }
}

async function runFatalChild(
  mode: 'uncaughtException' | 'unhandledRejection',
): Promise<{ code: number | null; output: string; payload: string }> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    request.on('end', () => {
      requests.push(decodeBody(request, Buffer.concat(chunks)));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"status":1}');
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  const overdeckHome = mkdtempSync(join(tmpdir(), 'overdeck-fatal-telemetry-'));
  tempDirs.push(overdeckHome);

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        '--import', 'tsx', fixture, mode,
      ], {
        env: {
          ...process.env,
          NODE_ENV: 'production',
          OVERDECK_HOME: overdeckHome,
          POSTHOG_API_KEY: 'phc_test',
          POSTHOG_HOST: `http://127.0.0.1:${address.port}`,
          VITEST: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { output += chunk; });
      child.stderr.on('data', (chunk: string) => { output += chunk; });
      child.once('error', reject);
      child.once('close', (code) => {
        resolve({ code, output, payload: requests.join('\n') });
      });
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve(); });
    });
  }
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('fatal Node telemetry', () => {
  it.each([
    ['uncaughtException', 'uncaught_exception'],
    ['unhandledRejection', 'unhandled_rejection'],
  ] as const)(
    'captures sanitized %s telemetry and exits nonzero',
    async (mode, action) => {
      const result = await runFatalChild(mode);

      expect(result.code).toBe(1);
      expect(result.payload).toContain(`Overdeck ${action} operation failed`);
      expect(result.payload).toContain(`"action":"${action}"`);
      expect(`${result.output}\n${result.payload}`).not.toContain('PAN-2599');
      expect(`${result.output}\n${result.payload}`).not.toContain('/home/alice');
      expect(`${result.output}\n${result.payload}`).not.toContain('ghp_secret');
    },
    15_000,
  );
});
