import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attestReviewContextManifest,
  attestReviewReport,
  readAttestedReviewReports,
} from '../cloister/review-artifact-attestation.js';
import {
  ensureReviewAttestationKey,
  REVIEW_ATTESTATION_KEY_ENV,
} from '../review-attestation-key.js';

const ISSUE_ID = 'PAN-3511';
const RUN_ID = 'agent-pan-3511-review-restart-att1';
const HEAD_SHA = 'a'.repeat(40);
let root: string;
let workspacePath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'review-key-restart-'));
  workspacePath = join(root, 'workspace');
  mkdirSync(workspacePath, { recursive: true });
  vi.stubEnv('OVERDECK_HOME', join(root, 'overdeck-home'));
  vi.stubEnv(REVIEW_ATTESTATION_KEY_ENV, '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('review attestation key persistence', () => {
  it('keeps signed reports valid across host restarts', () => {
    const firstKey = ensureReviewAttestationKey();

    const runDir = join(workspacePath, '.pan', 'review', RUN_ID);
    mkdirSync(runDir, { recursive: true });
    const contextPath = join(runDir, 'context.json');
    writeFileSync(contextPath, JSON.stringify({ issueId: ISSUE_ID, runId: RUN_ID, headSha: HEAD_SHA }));
    attestReviewContextManifest(contextPath);
    writeFileSync(join(runDir, 'synthesis.md'), '## Verdict: APPROVED\n');
    attestReviewReport({
      issueId: ISSUE_ID,
      runId: RUN_ID,
      workspacePath,
      expectedVerdict: 'passed',
    });

    delete process.env[REVIEW_ATTESTATION_KEY_ENV];
    const restartedKey = ensureReviewAttestationKey();

    expect(restartedKey).toBe(firstKey);
    expect(readAttestedReviewReports({ issueId: ISSUE_ID, runId: RUN_ID, workspacePath }))
      .toHaveLength(1);
    expect(statSync(join(root, 'overdeck-home', 'review-attestation-key')).mode & 0o777)
      .toBe(0o600);
  });

  it('materializes an environment-supplied key at the protected canonical path', () => {
    const supplied = 'environment-review-attestation-key-material-123456789';
    process.env[REVIEW_ATTESTATION_KEY_ENV] = supplied;

    expect(ensureReviewAttestationKey()).toBe(supplied);

    const path = join(root, 'overdeck-home', 'review-attestation-key');
    expect(readFileSync(path, 'utf8').trim()).toBe(supplied);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('fails loudly when environment and persisted signing keys disagree', () => {
    const persisted = ensureReviewAttestationKey();
    process.env[REVIEW_ATTESTATION_KEY_ENV] = `${persisted}-different`;

    expect(() => ensureReviewAttestationKey()).toThrow(
      'review attestation key environment does not match persisted key',
    );
  });

  it('fails loudly instead of rotating an invalid persisted key', () => {
    const home = join(root, 'overdeck-home');
    mkdirSync(home, { recursive: true });
    const path = join(home, 'review-attestation-key');
    writeFileSync(path, 'truncated\n', { mode: 0o600 });

    expect(() => ensureReviewAttestationKey()).toThrow(`review attestation key file is invalid: ${path}`);
  });
});
