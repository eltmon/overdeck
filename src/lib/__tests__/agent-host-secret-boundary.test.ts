import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAgentHostSecretBoundaryPrelude } from '../agent-host-secret-boundary.js';
import { buildChildEnvWithoutTmuxSync } from '../child-env.js';
import {
  REVIEW_ATTESTATION_KEY_ENV,
  REVIEW_ATTESTATION_TOKEN_ENV,
  ensureReviewAttestationKey,
  reviewAttestationKeyFilePath,
} from '../review-attestation-key.js';
import { shellQuote } from '../shell-quote.js';

const execFileAsync = promisify(execFile);

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'review-attestation-boundary-'));
  vi.stubEnv('OVERDECK_HOME', join(root, 'overdeck-home'));
  vi.stubEnv(REVIEW_ATTESTATION_KEY_ENV, '');
  vi.stubEnv(REVIEW_ATTESTATION_TOKEN_ENV, '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('agent host-secret boundary', () => {
  it('fails closed on a platform without a supported mount boundary', () => {
    const lines = buildAgentHostSecretBoundaryPrelude('win32', '/host/review-key');
    expect(lines.join('\n')).toContain('unsupported platform win32');
    expect(lines.join('\n')).toContain('exit 78');
  });

  it('fails closed when the required Linux boundary tool is unavailable', async () => {
    if (process.platform !== 'linux') return;

    ensureReviewAttestationKey();
    const launcherPath = join(root, 'missing-bwrap-launcher.sh');
    writeFileSync(launcherPath, [
      '#!/bin/bash',
      ...buildAgentHostSecretBoundaryPrelude(),
      'exit 0',
      '',
    ].join('\n'), { mode: 0o700 });

    await expect(execFileAsync(launcherPath, {
      env: {
        HOME: root,
        OVERDECK_HOME: join(root, 'overdeck-home'),
        PATH: join(root, 'empty-bin'),
      },
    })).rejects.toMatchObject({
      code: 78,
      stderr: expect.stringContaining('bubblewrap (bwrap) is required'),
    });
  });

  it('prevents a workspace subprocess from reading the key, deriving a run token, or obtaining attestation', async () => {
    if (process.platform !== 'linux') return;

    const key = ensureReviewAttestationKey();
    const expectedToken = 'active-review-run-token-that-must-not-cross-the-boundary';
    process.env[REVIEW_ATTESTATION_TOKEN_ENV] = expectedToken;

    const server = createServer((request, response) => {
      const token = String(request.headers['x-overdeck-review-attestation-token'] ?? '');
      response.writeHead(token === expectedToken ? 201 : 401).end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('probe server did not bind a TCP port');
      const keyPath = reviewAttestationKeyFilePath();
      const probePath = join(root, 'workspace-probe.cjs');
      writeFileSync(probePath, `
        const { readFileSync } = require('node:fs');
        void (async () => {
          let signingKey = null;
          try { signingKey = readFileSync(process.env.PROBE_KEY_PATH, 'utf8').trim(); } catch {}
          const token = process.env.OVERDECK_REVIEW_ATTESTATION_TOKEN || '';
          const result = await fetch(process.env.PROBE_URL, {
            method: 'POST',
            headers: { 'x-overdeck-review-attestation-token': token },
          });
          process.stdout.write(JSON.stringify({ readable: signingKey === process.env.PROBE_EXPECTED_KEY, token, status: result.status }));
        })();
      `);

      const launcherPath = join(root, 'workspace-launcher.sh');
      writeFileSync(launcherPath, [
        '#!/bin/bash',
        ...buildAgentHostSecretBoundaryPrelude(),
        `exec ${shellQuote(process.execPath)} ${shellQuote(probePath)}`,
        '',
      ].join('\n'), { mode: 0o700 });

      const env = buildChildEnvWithoutTmuxSync(process.env, {
        OVERDECK_HOME: join(root, 'overdeck-home'),
        // A workspace cannot bypass the boundary by pre-setting a marker in its
        // inherited environment; isolation is detected by the masked key itself.
        OVERDECK_AGENT_HOST_SECRET_BOUNDARY: '1',
        PROBE_KEY_PATH: keyPath,
        PROBE_EXPECTED_KEY: key,
        PROBE_URL: `http://127.0.0.1:${address.port}/attest`,
      });
      const { stdout } = await execFileAsync(launcherPath, { env });
      const result = JSON.parse(stdout) as { readable: boolean; token: string; status: number };

      expect(result).toEqual({ readable: false, token: '', status: 401 });
      expect(result.token).not.toBe(expectedToken);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
