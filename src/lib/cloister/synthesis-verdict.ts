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
import { readFile, stat } from 'fs/promises';
import { join } from 'path';

import { resolveProjectFromIssueSync } from '../projects.js';
import {
  findVerdictReportAsync,
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
export const ARTIFACT_VERDICT_MEMO_TTL_MS = 60_000;
export const ARTIFACT_VERDICT_MEMO_MAX_ENTRIES = 256;

type ArtifactReadOptions = { now?: number; workspacePath?: string; runId?: string };

interface ArtifactVerdictMemoEntry {
  value: SynthesisArtifactVerdict | null;
  expiresAt: number;
}

const artifactVerdictMemo = new Map<string, ArtifactVerdictMemoEntry>();

function resolveWorkspacePath(issueId: string, workspacePath?: string): string | null {
  if (workspacePath) return workspacePath;
  const resolved = resolveProjectFromIssueSync(issueId);
  return resolved ? join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`) : null;
}

async function readHeadEvidenceAsync(runDir: string): Promise<string | undefined> {
  try {
    const context = JSON.parse(await readFile(join(runDir, 'context.json'), 'utf-8')) as { headSha?: unknown };
    if (typeof context.headSha === 'string' && context.headSha.length > 0) return context.headSha;
  } catch { /* head is optional evidence (quick mode often omits context.json) */ }
  return undefined;
}

function readNotes(content: string, topBlocker: string): string | undefined {
  if (topBlocker) return topBlocker;
  const summary = content.match(/^##\s*Summary[^\n]*\n+(.{10,400}?)(\n##|\n*$)/ms)?.[1]?.trim().replace(/\s+/g, ' ');
  return summary || undefined;
}

function buildVerdict(runId: string, content: string, mtimeMs: number, headSha?: string): SynthesisArtifactVerdict | null {
  const parsed = parseVerdictReport(content);
  if (!parsed) return null;
  const notes = readNotes(content, parsed.topBlocker);
  return {
    runId,
    verdict: parsed.verdict,
    ...(notes ? { notes } : {}),
    ...(headSha ? { headSha } : {}),
    mtimeMs,
  };
}

function memoKey(issueId: string, runId: string): string {
  return `${issueId}:${runId}`;
}

function storeMemoizedArtifactVerdict(
  issueId: string,
  runId: string,
  value: SynthesisArtifactVerdict | null,
  now: number,
): void {
  const expiresAt = value
    ? Math.min(now + ARTIFACT_VERDICT_MEMO_TTL_MS, value.mtimeMs + SYNTHESIS_ARTIFACT_FRESH_MS)
    : now + ARTIFACT_VERDICT_MEMO_TTL_MS;
  const key = memoKey(issueId, runId);
  artifactVerdictMemo.delete(key);
  artifactVerdictMemo.set(key, { value, expiresAt });
  if (artifactVerdictMemo.size > ARTIFACT_VERDICT_MEMO_MAX_ENTRIES) {
    const oldestKey = artifactVerdictMemo.keys().next().value;
    if (oldestKey) artifactVerdictMemo.delete(oldestKey);
  }
}

/**
 * Non-blocking reader for serial deacon and feedback recovery paths. It reads
 * only the host-recorded active run and never scans sibling review directories.
 * Each result also refreshes the bounded memo used by the synchronous status
 * resolver, so that resolver never performs workspace I/O itself.
 */
export async function readLatestSynthesisVerdictAsync(
  issueId: string,
  options: ArtifactReadOptions = {},
): Promise<SynthesisArtifactVerdict | null> {
  const now = options.now ?? Date.now();
  if (!options.runId) return null;
  const workspacePath = resolveWorkspacePath(issueId, options.workspacePath);
  if (!workspacePath) return null;

  const runDir = join(workspacePath, '.pan', 'review', options.runId);
  const report = await findVerdictReportAsync(runDir);
  if (!report) {
    storeMemoizedArtifactVerdict(issueId, options.runId, null, now);
    return null;
  }

  let mtimeMs: number;
  let content: string;
  try {
    [mtimeMs, content] = [
      (await stat(report.path)).mtimeMs,
      await readFile(report.path, 'utf-8'),
    ];
  } catch {
    storeMemoizedArtifactVerdict(issueId, options.runId, null, now);
    return null;
  }
  const verdict = now - mtimeMs > SYNTHESIS_ARTIFACT_FRESH_MS
    ? null
    : buildVerdict(options.runId, content, mtimeMs, await readHeadEvidenceAsync(runDir));
  storeMemoizedArtifactVerdict(issueId, options.runId, verdict, now);
  return verdict;
}

/**
 * Returns only a previously populated active-run artifact memo entry. Status
 * reads use this after their stale-journal predicate and must retain the
 * existing refusal on a cold or expired entry rather than reading the workspace.
 */
export function readMemoizedArtifactVerdict(
  issueId: string,
  options: ArtifactReadOptions = {},
): SynthesisArtifactVerdict | null {
  if (!options.runId) return null;
  const now = options.now ?? Date.now();
  const key = memoKey(issueId, options.runId);
  const cached = artifactVerdictMemo.get(key);
  if (!cached || now >= cached.expiresAt) {
    artifactVerdictMemo.delete(key);
    return null;
  }
  artifactVerdictMemo.delete(key);
  artifactVerdictMemo.set(key, cached);
  return cached.value;
}

/** Test seam — module-level memo state leaks across tests in a file otherwise. */
export function __resetArtifactVerdictMemo(): void {
  artifactVerdictMemo.clear();
}

/** Test seam — exposes the bounded memo cardinality without leaking its entries. */
export function __artifactVerdictMemoSize(): number {
  return artifactVerdictMemo.size;
}
