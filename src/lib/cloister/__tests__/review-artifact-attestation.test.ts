import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  canonicalReviewedHeadFromContext,
  readAttestedReviewReports,
} from '../review-artifact-attestation.js';
import {
  installTestReviewAttestationKey,
  writeAttestedReviewArtifact,
} from './review-artifact-test-helpers.js';

const ISSUE = 'PAN-3511';
const RUN_ID = 'agent-pan-3511-review-polyrepo-att1';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
let workspacePath: string;

beforeEach(() => {
  installTestReviewAttestationKey();
  workspacePath = mkdtempSync(join(tmpdir(), 'review-attestation-'));
});

afterEach(() => {
  rmSync(workspacePath, { recursive: true, force: true });
});

describe('canonicalReviewedHeadFromContext', () => {
  it('formats polyrepo heads in manifest order with full SHAs', () => {
    expect(canonicalReviewedHeadFromContext({
      repos: [
        { repoKey: 'frontend', headSha: SHA_A },
        { repoKey: 'backend', headSha: SHA_B },
      ],
    })).toBe(`frontend@${SHA_A} backend@${SHA_B}`);
  });

  it('rejects shortened SHAs and ambiguous repo keys', () => {
    expect(canonicalReviewedHeadFromContext({ repos: [{ repoKey: 'front end', headSha: SHA_A }] })).toBeUndefined();
    expect(canonicalReviewedHeadFromContext({ repos: [{ repoKey: 'frontend', headSha: 'abc123' }] })).toBeUndefined();
  });
});

describe('polyrepo report attestation', () => {
  it('returns the same composite anchor used by workspace HEAD snapshots', () => {
    writeAttestedReviewArtifact({
      workspacePath,
      issueId: ISSUE,
      runId: RUN_ID,
      filename: 'synthesis.md',
      body: '## Verdict: APPROVED\n',
      repos: [
        { repoKey: 'frontend', headSha: SHA_A },
        { repoKey: 'backend', headSha: SHA_B },
      ],
    });

    expect(readAttestedReviewReports({ issueId: ISSUE, runId: RUN_ID, workspacePath })[0]?.reviewedHead)
      .toBe(`frontend@${SHA_A} backend@${SHA_B}`);
  });

  it('invalidates the report when one sub-repository head moves in context.json', () => {
    const reportPath = writeAttestedReviewArtifact({
      workspacePath,
      issueId: ISSUE,
      runId: RUN_ID,
      filename: 'synthesis.md',
      body: '## Verdict: APPROVED\n',
      repos: [
        { repoKey: 'frontend', headSha: SHA_A },
        { repoKey: 'backend', headSha: SHA_B },
      ],
    });
    expect(reportPath).toContain('synthesis.md');

    writeFileSync(join(workspacePath, '.pan', 'review', RUN_ID, 'context.json'), JSON.stringify({
      issueId: ISSUE,
      runId: RUN_ID,
      repos: [
        { repoKey: 'frontend', headSha: SHA_A },
        { repoKey: 'backend', headSha: 'c'.repeat(40) },
      ],
    }));

    expect(readAttestedReviewReports({ issueId: ISSUE, runId: RUN_ID, workspacePath })).toEqual([]);
  });
});
