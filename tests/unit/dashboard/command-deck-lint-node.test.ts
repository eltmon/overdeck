import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLintSessionNode } from '../../../src/dashboard/server/routes/command-deck-lint-node.js';
import type { VerificationArtifact } from '../../../src/lib/cloister/verification-artifact.js';
import type { ReviewStatus } from '../../../src/lib/review-status.js';

const RAN_AT = '2026-07-17T12:00:00.000Z';

let workspacePath: string;

beforeEach(() => {
  workspacePath = mkdtempSync(join(tmpdir(), 'command-deck-lint-node-'));
});

afterEach(() => {
  rmSync(workspacePath, { recursive: true, force: true });
});

function centralStatus(
  verificationStatus: NonNullable<ReviewStatus['verificationStatus']>,
): ReviewStatus {
  return {
    issueId: 'PAN-2665',
    reviewStatus: 'pending',
    testStatus: 'pending',
    verificationStatus,
    updatedAt: RAN_AT,
    readyForMerge: false,
  };
}

function writeArtifact(artifact: VerificationArtifact): void {
  const artifactDir = join(workspacePath, '.overdeck');
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    join(artifactDir, 'verification-latest.json'),
    JSON.stringify(artifact),
  );
}

function build(options: {
  includeTranscripts?: boolean;
  centralStatus?: ReviewStatus | null;
} = {}) {
  return buildLintSessionNode({
    workspacePath,
    issueLower: 'pan-2665',
    includeTranscripts: options.includeTranscripts ?? true,
    centralStatus: options.centralStatus ?? null,
  });
}

describe('buildLintSessionNode', () => {
  it.each([
    ['no central status', null],
    ['skipped verification', centralStatus('skipped')],
  ])('returns null without an artifact for %s', (_label, status) => {
    expect(build({ centralStatus: status })).toBeNull();
  });

  it('returns a failed ended node with gate output from a failed artifact', () => {
    writeArtifact({
      issueId: 'PAN-2665',
      ranAt: RAN_AT,
      outcome: 'failed',
      failedCheck: 'lint',
      gates: [{
        name: 'lint',
        passed: false,
        required: true,
        durationMs: 2_000,
        output: 'lint failed on src/example.ts',
      }],
    });

    const node = build();

    expect(node).toMatchObject({
      status: 'failed',
      presence: 'ended',
      endedAt: RAN_AT,
    });
    expect(node?.transcript).toContain('✗ lint (2.0s) FAILED');
    expect(node?.transcript).toContain('--- lint output ---');
    expect(node?.transcript).toContain('lint failed on src/example.ts');
  });

  it('returns a running active node with the current gate from a running artifact', () => {
    writeArtifact({
      issueId: 'PAN-2665',
      ranAt: RAN_AT,
      outcome: 'running',
      currentGate: 'test',
      gates: [{
        name: 'lint',
        passed: true,
        required: true,
        durationMs: 1_250,
      }],
    });

    const node = build();

    expect(node).toMatchObject({
      status: 'running',
      presence: 'active',
    });
    expect(node).not.toHaveProperty('endedAt');
    expect(node?.transcript).toContain('▶ test running…');
  });

  it('returns a completed node with fallback details for passed legacy verification', () => {
    const node = build({ centralStatus: centralStatus('passed') });

    expect(node).toMatchObject({
      status: 'completed',
      presence: 'ended',
    });
    expect(node?.transcript).toContain('No gate details recorded for the last run.');
  });

  it('omits the transcript when transcripts are not requested', () => {
    writeArtifact({
      issueId: 'PAN-2665',
      ranAt: RAN_AT,
      outcome: 'passed',
      gates: [{
        name: 'typecheck',
        passed: true,
        required: true,
        durationMs: 900,
      }],
    });

    expect(build({ includeTranscripts: false })).not.toHaveProperty('transcript');
  });
});
