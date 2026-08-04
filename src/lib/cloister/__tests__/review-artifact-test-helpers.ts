import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REVIEW_ATTESTATION_KEY_ENV } from '../../review-attestation-key.js';
import {
  attestReviewContextManifest,
  attestReviewReport,
} from '../review-artifact-attestation.js';
import { parseVerdictReport, type VerdictReportFilename } from '../review-verdict-report.js';

export const TEST_REVIEW_HEAD = 'a'.repeat(40);
export const TEST_REVIEW_ATTESTATION_KEY = 'test-review-attestation-key-material-1234567890';

export function installTestReviewAttestationKey(): void {
  process.env[REVIEW_ATTESTATION_KEY_ENV] = TEST_REVIEW_ATTESTATION_KEY;
}

export function writeAttestedReviewArtifact(options: {
  workspacePath: string;
  issueId: string;
  runId: string;
  filename: VerdictReportFilename;
  body: string;
  headSha?: string;
  repos?: Array<{ repoKey: string; headSha: string }>;
  attest?: boolean;
}): string {
  installTestReviewAttestationKey();
  const runDir = join(options.workspacePath, '.pan', 'review', options.runId);
  mkdirSync(runDir, { recursive: true });
  const contextPath = join(runDir, 'context.json');
  writeFileSync(contextPath, JSON.stringify({
    issueId: options.issueId,
    runId: options.runId,
    headSha: options.headSha ?? TEST_REVIEW_HEAD,
    ...(options.repos ? { repos: options.repos } : {}),
  }));
  attestReviewContextManifest(contextPath);

  const reportPath = join(runDir, options.filename);
  writeFileSync(reportPath, options.body);
  if (options.attest === false) return reportPath;
  const parsed = parseVerdictReport(options.body);
  if (!parsed) throw new Error('test report body has no verdict');
  attestReviewReport({
    issueId: options.issueId,
    runId: options.runId,
    workspacePath: options.workspacePath,
    expectedVerdict: parsed.verdict,
  });
  return reportPath;
}
