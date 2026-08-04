import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  REVIEW_ATTESTATION_VERSION,
  signReviewAttestationPayload,
  verifyReviewAttestationSignature,
} from '../review-attestation-key.js';
import {
  parseVerdictReport,
  VERDICT_REPORT_FILENAMES,
  type ReviewVerdict,
  type VerdictReportFilename,
} from './review-verdict-report.js';

interface ReviewContextData {
  issueId?: unknown;
  runId?: unknown;
  headSha?: unknown;
  repos?: unknown;
}

interface SignedAttestation {
  version: number;
  kind: 'review-context' | 'review-report';
  issueId: string;
  runId: string;
  subjectFile: string;
  subjectSha256: string;
  reviewedHead?: string;
  issuedAt: string;
  signature: string;
}

export interface VerifiedReviewContext {
  context: ReviewContextData;
  reviewedHead?: string;
}

export interface AttestedReviewReport {
  filename: VerdictReportFilename;
  path: string;
  verdict: ReviewVerdict;
  topBlocker: string;
  reviewedHead?: string;
  mtimeMs: number;
  content: string;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function unsignedPayload(attestation: Omit<SignedAttestation, 'signature'>): string {
  return JSON.stringify(attestation);
}

function attestationPath(subjectPath: string): string {
  return `${subjectPath}.attestation.json`;
}

function writeSignedAttestation(
  subjectPath: string,
  unsigned: Omit<SignedAttestation, 'signature'>,
): SignedAttestation {
  const signature = signReviewAttestationPayload(unsignedPayload(unsigned));
  if (!signature) throw new Error('review artifact attestation key is unavailable');
  const signed = { ...unsigned, signature };
  writeFileSync(attestationPath(subjectPath), JSON.stringify(signed, null, 2));
  return signed;
}

function readValidAttestation(
  subjectPath: string,
  expected: Pick<SignedAttestation, 'kind' | 'issueId' | 'runId' | 'subjectFile' | 'subjectSha256'>
  & Partial<Pick<SignedAttestation, 'reviewedHead'>>,
): SignedAttestation | null {
  try {
    const parsed = JSON.parse(readFileSync(attestationPath(subjectPath), 'utf-8')) as SignedAttestation;
    if (parsed.version !== REVIEW_ATTESTATION_VERSION) return null;
    if (parsed.kind !== expected.kind || parsed.issueId !== expected.issueId || parsed.runId !== expected.runId) return null;
    if (parsed.subjectFile !== expected.subjectFile || parsed.subjectSha256 !== expected.subjectSha256) return null;
    if (parsed.reviewedHead !== expected.reviewedHead) return null;
    const { signature, ...unsigned } = parsed;
    return verifyReviewAttestationSignature(unsignedPayload(unsigned), signature) ? parsed : null;
  } catch {
    return null;
  }
}

export function canonicalReviewedHeadFromContext(context: ReviewContextData): string | undefined {
  if (Array.isArray(context.repos) && context.repos.length > 0) {
    const entries: string[] = [];
    for (const repo of context.repos) {
      if (!repo || typeof repo !== 'object') return undefined;
      const repoKey = (repo as { repoKey?: unknown }).repoKey;
      const headSha = (repo as { headSha?: unknown }).headSha;
      if (typeof repoKey !== 'string' || !repoKey || /[\s@]/.test(repoKey)) return undefined;
      if (typeof headSha !== 'string' || !/^[0-9a-f]{40,64}$/i.test(headSha)) return undefined;
      entries.push(`${repoKey}@${headSha}`);
    }
    return entries.join(' ');
  }
  return typeof context.headSha === 'string' && /^[0-9a-f]{40,64}$/i.test(context.headSha)
    ? context.headSha
    : undefined;
}

export function attestReviewContextManifest(contextPath: string): void {
  const content = readFileSync(contextPath, 'utf-8');
  const context = JSON.parse(content) as ReviewContextData;
  if (typeof context.issueId !== 'string' || typeof context.runId !== 'string') {
    throw new Error('review context is missing issueId or runId');
  }
  writeSignedAttestation(contextPath, {
    version: REVIEW_ATTESTATION_VERSION,
    kind: 'review-context',
    issueId: context.issueId,
    runId: context.runId,
    subjectFile: basename(contextPath),
    subjectSha256: sha256(content),
    issuedAt: new Date().toISOString(),
  });
}

export function verifyReviewContextManifest(
  runDir: string,
  issueId: string,
  runId: string,
): VerifiedReviewContext | null {
  try {
    const contextPath = join(runDir, 'context.json');
    const content = readFileSync(contextPath, 'utf-8');
    const context = JSON.parse(content) as ReviewContextData;
    if (context.issueId !== issueId || context.runId !== runId) return null;
    const valid = readValidAttestation(contextPath, {
      kind: 'review-context',
      issueId,
      runId,
      subjectFile: 'context.json',
      subjectSha256: sha256(content),
      reviewedHead: undefined,
    });
    if (!valid) return null;
    const reviewedHead = canonicalReviewedHeadFromContext(context);
    if (!reviewedHead) return null;
    return { context, reviewedHead };
  } catch {
    return null;
  }
}

export function attestReviewReport(options: {
  issueId: string;
  runId: string;
  workspacePath: string;
  expectedVerdict: ReviewVerdict;
}): AttestedReviewReport {
  const runDir = join(options.workspacePath, '.pan', 'review', options.runId);
  const verifiedContext = verifyReviewContextManifest(runDir, options.issueId, options.runId);
  if (!verifiedContext) throw new Error('review context attestation is missing or invalid');

  const candidates: AttestedReviewReport[] = [];
  for (const filename of VERDICT_REPORT_FILENAMES) {
    const path = join(runDir, filename);
    try {
      const content = readFileSync(path, 'utf-8');
      const parsed = parseVerdictReport(content);
      if (!parsed || parsed.verdict !== options.expectedVerdict) continue;
      candidates.push({
        filename,
        path,
        verdict: parsed.verdict,
        topBlocker: parsed.topBlocker,
        ...(verifiedContext.reviewedHead ? { reviewedHead: verifiedContext.reviewedHead } : {}),
        mtimeMs: statSync(path).mtimeMs,
        content,
      });
    } catch {
      // Try the other supported report shape.
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const selected = candidates[0];
  if (!selected) throw new Error(`no ${options.expectedVerdict} review report exists for ${options.runId}`);

  const signed = writeSignedAttestation(selected.path, {
    version: REVIEW_ATTESTATION_VERSION,
    kind: 'review-report',
    issueId: options.issueId,
    runId: options.runId,
    subjectFile: selected.filename,
    subjectSha256: sha256(selected.content),
    ...(selected.reviewedHead ? { reviewedHead: selected.reviewedHead } : {}),
    issuedAt: new Date().toISOString(),
  });
  return { ...selected, mtimeMs: Date.parse(signed.issuedAt) };
}

export function readAttestedReviewReports(options: {
  issueId: string;
  runId: string;
  workspacePath: string;
}): AttestedReviewReport[] {
  const runDir = join(options.workspacePath, '.pan', 'review', options.runId);
  const verifiedContext = verifyReviewContextManifest(runDir, options.issueId, options.runId);
  if (!verifiedContext) return [];

  const reports: AttestedReviewReport[] = [];
  for (const filename of VERDICT_REPORT_FILENAMES) {
    const path = join(runDir, filename);
    try {
      const content = readFileSync(path, 'utf-8');
      const parsed = parseVerdictReport(content);
      if (!parsed) continue;
      const valid = readValidAttestation(path, {
        kind: 'review-report',
        issueId: options.issueId,
        runId: options.runId,
        subjectFile: filename,
        subjectSha256: sha256(content),
        reviewedHead: verifiedContext.reviewedHead,
      });
      if (!valid) continue;
      const attestedAtMs = Date.parse(valid.issuedAt);
      if (!Number.isFinite(attestedAtMs)) continue;
      reports.push({
        filename,
        path,
        verdict: parsed.verdict,
        topBlocker: parsed.topBlocker,
        ...(verifiedContext.reviewedHead ? { reviewedHead: verifiedContext.reviewedHead } : {}),
        mtimeMs: attestedAtMs,
        content,
      });
    } catch {
      // Missing or unreadable evidence is not authoritative.
    }
  }
  return reports.sort((a, b) => b.mtimeMs - a.mtimeMs);
}
