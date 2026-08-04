/*
 * Synthesis-artifact verdict reader — the race guard for review recovery.
 *
 * The review verdict artifact is the review verdict of RECORD:
 * `.pan/review/<run>/synthesis.md` for convoy reviews,
 * `.pan/review/<run>/review.md` for quick/self reviews (the fleet default,
 * PAN-1981). Recovery paths that evaluate a 'reviewing' row must consult the
 * artifact before declaring the review dead: a just-finished reviewer writes
 * it seconds to minutes BEFORE the verdict syncs into the review_status row,
 * so history-only recovery wiped APPROVED verdicts (five losses on PAN-1577
 * in one evening, 2026-08-02).
 *
 * Both shapes are honored through the unified door in
 * review-verdict-report.ts — the quick mode's blocked vocabulary is
 * CHANGES REQUESTED, which a synthesis-only reader cannot see. A recovery
 * path that reads only synthesis.md is blind to the fleet's default mode.
 *
 * A workspace file is evidence, not authority by itself. Recovery accepts a
 * report only from the active review run recorded by the agent-state read door,
 * with the per-run capability that the host injected into that reviewer's
 * prompt. A work or test process can create another `.pan/review/*` directory,
 * but it cannot make that directory the host-recorded run or mint its capability.
 */
import { readFileSync, statSync } from 'fs';
import { basename, join } from 'path';

import { getReviewArtifactProvenanceSync } from '../overdeck/agent-review-provenance.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { reviewArtifactCapabilityMarker } from './review-artifact-capability.js';
import {
  findVerdictReport,
  parseVerdictReport,
  type ReviewVerdict,
} from './review-verdict-report.js';

export interface SynthesisArtifactVerdict {
  verdict: ReviewVerdict;
  notes?: string;
  headSha?: string;
  /** Host-recorded review run that produced this artifact. */
  runId: string;
  /** mtime (ms) of the verdict artifact — must belong to the CURRENT review cycle. */
  mtimeMs: number;
}

export interface SynthesisArtifactReadOptions {
  now?: number;
  workspacePath?: string;
  /** Test/recovery injection; production resolves both values from agent state. */
  reviewRunId?: string;
  reviewArtifactCapability?: string;
}

interface TrustedReviewRun {
  workspacePath: string;
  runId: string;
  capability: string;
}

/**
 * Staleness: the artifact is honored only when it is FRESH (within
 * SYNTHESIS_ARTIFACT_FRESH_MS) — an artifact from an older cycle must never
 * resurrect over a newly spawned review.
 */
export const SYNTHESIS_ARTIFACT_FRESH_MS = 30 * 60_000;

function resolveTrustedReviewRun(
  issueId: string,
  options: SynthesisArtifactReadOptions,
): TrustedReviewRun | null {
  const state = options.reviewRunId && options.reviewArtifactCapability
    ? null
    : getReviewArtifactProvenanceSync(`agent-${issueId.toLowerCase()}-review`);
  const runId = options.reviewRunId ?? state?.reviewRunId;
  const capability = options.reviewArtifactCapability ?? state?.reviewArtifactCapability;
  const workspacePath = options.workspacePath ?? state?.workspace ?? (() => {
    const resolved = resolveProjectFromIssueSync(issueId);
    return resolved ? join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`) : null;
  })();

  if (!workspacePath || !runId || !capability) return null;
  if (basename(runId) !== runId || !runId.startsWith(`agent-${issueId.toLowerCase()}-review`)) return null;
  return { workspacePath, runId, capability };
}

function readRunContext(
  runDir: string,
  issueId: string,
  runId: string,
): { headSha?: string } | null {
  try {
    const context = JSON.parse(readFileSync(join(runDir, 'context.json'), 'utf-8')) as {
      issueId?: unknown;
      runId?: unknown;
      headSha?: unknown;
    };
    if (context.issueId !== issueId || context.runId !== runId) return null;
    return typeof context.headSha === 'string' && context.headSha.length > 0
      ? { headSha: context.headSha }
      : {};
  } catch {
    return null;
  }
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
  const now = options.now ?? Date.now();
  const trusted = resolveTrustedReviewRun(issueId, options);
  if (!trusted) return null;

  const runDir = join(trusted.workspacePath, '.pan', 'review', trusted.runId);
  const context = readRunContext(runDir, issueId, trusted.runId);
  if (!context) return null;

  try {
    if (!statSync(runDir).isDirectory()) return null;
    const report = findVerdictReport(runDir);
    if (!report) return null;
    const mtimeMs = statSync(report.path).mtimeMs;
    if (now - mtimeMs >= SYNTHESIS_ARTIFACT_FRESH_MS) return null;

    const content = readFileSync(report.path, 'utf-8');
    const marker = reviewArtifactCapabilityMarker(trusted.capability);
    if (content.split(/\r?\n/, 1)[0] !== marker) return null;

    const parsed = parseVerdictReport(content);
    if (!parsed) return null;
    const notes = readNotes(content, parsed.topBlocker);

    return {
      verdict: parsed.verdict,
      ...(notes ? { notes } : {}),
      ...(context.headSha ? { headSha: context.headSha } : {}),
      runId: trusted.runId,
      mtimeMs,
    };
  } catch {
    return null;
  }
}

/*
 * Memoized artifact read for callers on a hot path (PAN-3511).
 *
 * `resolveJournalReconciledReviewStatusSync` runs on EVERY `getReviewStatusSync`
 * call in the system, so it cannot afford a directory walk per read. The key
 * includes host provenance, so a new review run never inherits the previous
 * run's cached verdict. Non-null entries expire at the earlier of the memo TTL
 * and the artifact freshness boundary. The bounded LRU also evicts completed
 * issue keys instead of retaining the fleet's lifetime issue history.
 */
export const ARTIFACT_VERDICT_MEMO_TTL_MS = 60_000;
export const ARTIFACT_VERDICT_MEMO_MAX_ENTRIES = 256;

interface ArtifactVerdictMemoEntry {
  value: SynthesisArtifactVerdict | null;
  expiresAt: number;
}

const artifactVerdictMemo = new Map<string, ArtifactVerdictMemoEntry>();

function memoKey(issueId: string, trusted: TrustedReviewRun): string {
  return JSON.stringify([
    issueId,
    trusted.workspacePath,
    trusted.runId,
    trusted.capability,
  ]);
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
    reviewArtifactCapability: trusted.capability,
  });
  const freshnessExpiry = value
    ? value.mtimeMs + SYNTHESIS_ARTIFACT_FRESH_MS
    : Number.POSITIVE_INFINITY;
  setMemoEntry(key, {
    value,
    expiresAt: Math.min(now + ARTIFACT_VERDICT_MEMO_TTL_MS, freshnessExpiry),
  });
  return value;
}

/** Test seams — module-level memo state leaks across tests in a file otherwise. */
export function __resetArtifactVerdictMemo(): void {
  artifactVerdictMemo.clear();
}

export function __artifactVerdictMemoSize(): number {
  return artifactVerdictMemo.size;
}
