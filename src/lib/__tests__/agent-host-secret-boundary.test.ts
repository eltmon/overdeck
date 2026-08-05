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
  createReviewAgentAttestationToken,
  ensureReviewAttestationKey,
  reviewAttestationKeyFilePath,
  verifyReviewAgentAttestationToken,
} from '../review-attestation-key.js';
import { shellQuote } from '../shell-quote.js';

const execFileAsync = promisify(execFile);
const AGENT_ID = 'agent-pan-3511-review';
const RUN_ID = 'agent-pan-3511-review-deadbeef-run-att1';

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

  it('prevents a workspace subprocess from reading the key, deriving a run token, or obtaining attestation', async () => {
    if (process.platform !== 'linux') return;

    const key = ensureReviewAttestationKey();
    const expectedToken = createReviewAgentAttestationToken(AGENT_ID, RUN_ID);
    expect(expectedToken).toBeTruthy();

    const server = createServer((request, response) => {
      const token = String(request.headers['x-overdeck-review-attestation-token'] ?? '');
      const accepted = verifyReviewAgentAttestationToken(AGENT_ID, RUN_ID, token);
      response.writeHead(accepted ? 201 : 401).end();
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
        const { createHmac } = require('node:crypto');
        const { readFileSync } = require('node:fs');
        void (async () => {
          let signingKey = null;
          try { signingKey = readFileSync(process.env.PROBE_KEY_PATH, 'utf8').trim(); } catch {}
          const payload = 'review-artifact-attestation:v1:' + process.env.PROBE_AGENT_ID + ':' + process.env.PROBE_RUN_ID;
          const token = signingKey ? createHmac('sha256', signingKey).update(payload).digest('base64url') : '';
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
        PROBE_KEY_PATH: keyPath,
        PROBE_EXPECTED_KEY: key,
        PROBE_AGENT_ID: AGENT_ID,
        PROBE_RUN_ID: RUN_ID,
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
