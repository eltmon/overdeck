/*
 * Synthesis-artifact verdict reader — the race guard for review recovery.
 *
 * The review verdict artifact is the review verdict of RECORD:
 * `.pan/review/<run>/synthesis.md` for convoy reviews and `review.md` for quick
 * reviews. Recovery accepts only a host-attested report from the active run;
 * workspace files cannot authorize a row write by themselves.
 */
import { basename, join } from 'node:path';

import { getReviewArtifactProvenanceSync } from '../overdeck/agent-review-provenance.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { readAttestedReviewReports } from './review-artifact-attestation.js';
import type { ReviewVerdict } from './review-verdict-report.js';

export interface SynthesisArtifactVerdict {
  verdict: ReviewVerdict;
  notes?: string;
  headSha?: string;
  /** Host-recorded review run that produced this artifact. */
  runId: string;
  /** mtime (ms) of the verdict artifact — must belong to the current review cycle. */
  mtimeMs: number;
}

export interface SynthesisArtifactReadOptions {
  now?: number;
  workspacePath?: string;
  /** Test/recovery injection; production resolves the value from the agent read door. */
  reviewRunId?: string;
}

interface TrustedReviewRun {
  workspacePath: string;
  runId: string;
}

/** Artifacts from an older review cycle are never recovery authority. */
export const SYNTHESIS_ARTIFACT_FRESH_MS = 30 * 60_000;

function resolveTrustedReviewRun(
  issueId: string,
  options: SynthesisArtifactReadOptions,
): TrustedReviewRun | null {
  const state = options.reviewRunId
    ? null
    : getReviewArtifactProvenanceSync(`agent-${issueId.toLowerCase()}-review`);
  const runId = options.reviewRunId ?? state?.reviewRunId;
  const workspacePath = options.workspacePath ?? state?.workspace ?? (() => {
    const resolved = resolveProjectFromIssueSync(issueId);
    return resolved ? join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`) : null;
  })();

  if (!workspacePath || !runId) return null;
  if (basename(runId) !== runId || !runId.startsWith(`agent-${issueId.toLowerCase()}-review`)) return null;
  return { workspacePath, runId };
}

function readNotes(content: string, topBlocker: string): string | undefined {
  if (topBlocker) return topBlocker;
  const summary = content.match(/^##\s*Summary[^\n]*\n+(.{10,400}?)(\n##|\n*$)/ms)?.[1]?.trim().replace(/\s+/g, ' ');
  return summary || undefined;
}

export function readLatestSynthesisVerdict(
  issueId: string,
  options: SynthesisArtifactReadOptions = {},
): SynthesisArtifactVerdict | null {
  try {
    const now = options.now ?? Date.now();
    const trusted = resolveTrustedReviewRun(issueId, options);
    if (!trusted) return null;
    const reports = readAttestedReviewReports({
      issueId,
      runId: trusted.runId,
      workspacePath: trusted.workspacePath,
    });
    const report = reports.find(candidate => now - candidate.mtimeMs < SYNTHESIS_ARTIFACT_FRESH_MS);
    if (!report) return null;
    const notes = readNotes(report.content, report.topBlocker);
    return {
      verdict: report.verdict,
      ...(notes ? { notes } : {}),
      ...(report.reviewedHead ? { headSha: report.reviewedHead } : {}),
      runId: trusted.runId,
      mtimeMs: report.mtimeMs,
    };
  } catch {
    return null;
  }
}

/*
 * Memoized artifact read for callers on the review-status hot path. Null results
 * retry after one minute; verified evidence stays cached until its 30-minute
 * freshness boundary. The bounded LRU evicts completed issue keys.
 */
export const ARTIFACT_VERDICT_MEMO_TTL_MS = 60_000;
export const ARTIFACT_VERDICT_MEMO_MAX_ENTRIES = 256;

interface ArtifactVerdictMemoEntry {
  value: SynthesisArtifactVerdict | null;
  expiresAt: number;
}

const artifactVerdictMemo = new Map<string, ArtifactVerdictMemoEntry>();

function memoKey(issueId: string, trusted: TrustedReviewRun): string {
  return JSON.stringify([issueId, trusted.workspacePath, trusted.runId]);
}

function setMemoEntry(key: string, entry: ArtifactVerdictMemoEntry): void {
  artifactVerdictMemo.delete(key);
  artifactVerdictMemo.set(key, entry);
  while (artifactVerdictMemo.size > ARTIFACT_VERDICT_MEMO_MAX_ENTRIES) {
    const oldest = artifactVerdictMemo.keys().next().value as string | undefined;
    if (!oldest) break;
    artifactVerdictMemo.delete(oldest);
  }
}

export function readMemoizedArtifactVerdict(
  issueId: string,
  options: SynthesisArtifactReadOptions = {},
): SynthesisArtifactVerdict | null {
  try {
    const now = options.now ?? Date.now();
    const trusted = resolveTrustedReviewRun(issueId, options);
    if (!trusted) return null;
    const key = memoKey(issueId, trusted);
    const cached = artifactVerdictMemo.get(key);
    if (cached && now < cached.expiresAt) {
      artifactVerdictMemo.delete(key);
      artifactVerdictMemo.set(key, cached);
      return cached.value;
    }
    if (cached) artifactVerdictMemo.delete(key);

    const value = readLatestSynthesisVerdict(issueId, {
      ...options,
      now,
      workspacePath: trusted.workspacePath,
      reviewRunId: trusted.runId,
    });
    setMemoEntry(key, {
      value,
      expiresAt: value
        ? value.mtimeMs + SYNTHESIS_ARTIFACT_FRESH_MS
        : now + ARTIFACT_VERDICT_MEMO_TTL_MS,
    });
    return value;
  } catch {
    return null;
  }
}

export function __resetArtifactVerdictMemo(): void {
  artifactVerdictMemo.clear();
}

export function __artifactVerdictMemoSize(): number {
  return artifactVerdictMemo.size;
}
