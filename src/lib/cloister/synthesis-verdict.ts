/**
 * Synthesis-artifact verdict reader — the race guard for review recovery.
 *
 * The review verdict artifact is evidence from the active review run:
 * `.pan/review/<run>/synthesis.md` for convoy reviews,
 * `.pan/review/<run>/review.md` for quick/self reviews (the fleet default,
 * PAN-1981). Recovery paths consult this evidence before declaring the review
 * dead because a reviewer can write it seconds to minutes before the canonical
 * done signal reaches `recordReviewVerdict()`. The workspace-writable artifact
 * never authorizes a terminal status transition on its own.
 *
 * Both shapes are honored through the unified door in
 * review-verdict-report.ts — the quick mode's blocked vocabulary is
 * CHANGES REQUESTED, which a synthesis-only reader cannot see. A recovery
 * path that reads only synthesis.md is blind to the fleet's default mode.
 */
import { readFileSync, statSync } from 'fs';
import { join } from 'path';

import { resolveProjectFromIssueSync } from '../projects.js';
import {
  findVerdictReport,
  parseVerdictReport,
  type ReviewVerdict,
} from './review-verdict-report.js';

export interface SynthesisArtifactVerdict {
  /** Review run directory that owns this verdict artifact. */
  runId: string;
  verdict: ReviewVerdict;
  notes?: string;
  headSha?: string;
  /** mtime (ms) of the verdict artifact — must belong to the CURRENT review cycle. */
  mtimeMs: number;
}

/**
 * Staleness: the artifact is honored only when it is FRESH (within
 * SYNTHESIS_ARTIFACT_FRESH_MS) — an artifact from an older cycle must never
 * resurrect over a newly spawned review.
 */
export const SYNTHESIS_ARTIFACT_FRESH_MS = 30 * 60_000;

function readHeadEvidence(runDir: string): string | undefined {
  try {
    const context = JSON.parse(readFileSync(join(runDir, 'context.json'), 'utf-8')) as { headSha?: unknown };
    if (typeof context.headSha === 'string' && context.headSha.length > 0) return context.headSha;
  } catch { /* head is optional evidence (quick mode often omits context.json) */ }
  return undefined;
}

function readNotes(content: string, topBlocker: string): string | undefined {
  if (topBlocker) return topBlocker;
  const summary = content.match(/^##\s*Summary[^\n]*\n+(.{10,400}?)(\n##|\n*$)/ms)?.[1]?.trim().replace(/\s+/g, ' ');
  return summary || undefined;
}

export function readLatestSynthesisVerdict(
  issueId: string,
  options: { now?: number; workspacePath?: string; runId?: string } = {},
): SynthesisArtifactVerdict | null {
  const now = options.now ?? Date.now();
  // Verdict artifacts are workspace-writable. A recovery path must bind its
  // read to the host-recorded active review run; scanning every run lets an old
  // or forged artifact become evidence for the current cycle.
  if (!options.runId) return null;
  const workspacePath = options.workspacePath ?? (() => {
    const resolved = resolveProjectFromIssueSync(issueId);
    return resolved ? join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`) : null;
  })();
  if (!workspacePath) return null;
  const reviewRoot = join(workspacePath, '.pan', 'review');
  try {
    if (!statSync(reviewRoot).isDirectory()) return null;
  } catch {
    return null;
  }

  const runDir = join(reviewRoot, options.runId);
  const report = findVerdictReport(runDir);
  if (!report) return null;

  let mtimeMs: number;
  let content: string;
  try {
    mtimeMs = statSync(report.path).mtimeMs;
    content = readFileSync(report.path, 'utf-8');
  } catch {
    return null;
  }
  if (now - mtimeMs > SYNTHESIS_ARTIFACT_FRESH_MS) return null;

  const parsed = parseVerdictReport(content);
  if (!parsed) return null;
  const notes = readNotes(content, parsed.topBlocker);
  const headSha = readHeadEvidence(runDir);

  return {
    runId: options.runId,
    verdict: parsed.verdict,
    ...(notes ? { notes } : {}),
    ...(headSha ? { headSha } : {}),
    mtimeMs,
  };
}

/**
 * Memoized artifact read for callers on a hot path (PAN-3511).
 *
 * Recovery patrols can consult this reader repeatedly, so it cannot afford a
 * filesystem scan for every pass. This wraps the reader in a short per-run TTL:
 * a caller that consults the artifact pays at most one scan per issue/run per
 * minute. Canonical review-status reads never call this function.
 *
 * A null result is memoized too — an issue with no artifact is the common case,
 * and re-scanning for an absent file every read is exactly the cost this avoids.
 */
export const ARTIFACT_VERDICT_MEMO_TTL_MS = 60_000;
export const ARTIFACT_VERDICT_MEMO_MAX_ENTRIES = 256;

const artifactVerdictMemo = new Map<string, { value: SynthesisArtifactVerdict | null; checkedAt: number }>();

export function readMemoizedArtifactVerdict(
  issueId: string,
  options: { now?: number; workspacePath?: string; runId?: string } = {},
): SynthesisArtifactVerdict | null {
  if (!options.runId) return null;
  const now = options.now ?? Date.now();
  const key = `${issueId}:${options.runId}`;
  const cached = artifactVerdictMemo.get(key);
  if (cached && now - cached.checkedAt < ARTIFACT_VERDICT_MEMO_TTL_MS) {
    artifactVerdictMemo.delete(key);
    artifactVerdictMemo.set(key, cached);
    return cached.value;
  }

  const value = readLatestSynthesisVerdict(issueId, {
    now,
    ...(options.workspacePath ? { workspacePath: options.workspacePath } : {}),
    runId: options.runId,
  });
  artifactVerdictMemo.set(key, { value, checkedAt: now });
  if (artifactVerdictMemo.size > ARTIFACT_VERDICT_MEMO_MAX_ENTRIES) {
    const oldestKey = artifactVerdictMemo.keys().next().value;
    if (oldestKey) artifactVerdictMemo.delete(oldestKey);
  }
  return value;
}

/** Test seam — module-level memo state leaks across tests in a file otherwise. */
export function __resetArtifactVerdictMemo(): void {
  artifactVerdictMemo.clear();
}

/** Test seam — exposes the bounded memo cardinality without leaking its entries. */
export function __artifactVerdictMemoSize(): number {
  return artifactVerdictMemo.size;
}
