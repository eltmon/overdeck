/**
 * Synthesis-artifact verdict reader — the race guard for review recovery.
 *
 * The synthesis artifact (`.pan/review/<run>/synthesis.md`) is the review
 * verdict of RECORD. Recovery paths that evaluate a 'reviewing' row must
 * consult it before declaring the review dead: a just-finished convoy writes
 * the artifact seconds to minutes BEFORE the verdict syncs into the
 * review_status row, so history-only recovery wiped APPROVED verdicts
 * (five losses on PAN-1577 in one evening, 2026-08-02).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { resolveProjectFromIssueSync } from '../projects.js';

export interface SynthesisArtifactVerdict {
  verdict: 'passed' | 'blocked' | 'failed';
  notes?: string;
  headSha?: string;
  /** mtime (ms) of synthesis.md — must belong to the CURRENT review cycle. */
  mtimeMs: number;
}

/**
 * The synthesis artifact is the review verdict of RECORD. The orphan-reset
 * path below historically trusted only the review_status history — but a
 * just-finished convoy writes `.pan/review/<run>/synthesis.md` seconds to
 * minutes BEFORE the history entry syncs into the row, so the patrol saw a
 * dead 'reviewing' row and reset it to pending, wiping APPROVED verdicts
 * (five losses on PAN-1577 in one evening, 2026-08-02). Read the artifact
 * before declaring any review dead.
 *
 * Staleness: the artifact is honored only when it is FRESH (within
 * SYNTHESIS_ARTIFACT_FRESH_MS) — an artifact from an older cycle must never
 * resurrect over a newly spawned review.
 */
export const SYNTHESIS_ARTIFACT_FRESH_MS = 30 * 60_000;

export function readLatestSynthesisVerdict(
  issueId: string,
  options: { now?: number; workspacePath?: string } = {},
): SynthesisArtifactVerdict | null {
  const now = options.now ?? Date.now();
  const workspacePath = options.workspacePath ?? (() => {
    const resolved = resolveProjectFromIssueSync(issueId);
    return resolved ? join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`) : null;
  })();
  if (!workspacePath) return null;
  const reviewRoot = join(workspacePath, '.pan', 'review');
  if (!existsSync(reviewRoot)) return null;

  // Newest run dir by mtime that carries a synthesis.md.
  let latest: { dir: string; mtimeMs: number } | null = null;
  try {
    for (const entry of readdirSync(reviewRoot)) {
      const synthesisPath = join(reviewRoot, entry, 'synthesis.md');
      if (!existsSync(synthesisPath)) continue;
      const mtimeMs = statSync(synthesisPath).mtimeMs;
      if (!latest || mtimeMs > latest.mtimeMs) latest = { dir: join(reviewRoot, entry), mtimeMs };
    }
  } catch {
    return null;
  }
  if (!latest || now - latest.mtimeMs > SYNTHESIS_ARTIFACT_FRESH_MS) return null;

  let verdict: SynthesisArtifactVerdict['verdict'] | null = null;
  let notes: string | undefined;
  try {
    const synthesis = readFileSync(join(latest.dir, 'synthesis.md'), 'utf-8');
    const match = synthesis.match(/^##\s*Verdict:\s*(APPROVED|BLOCKED|FAILED|PASSED)\b/im);
    if (!match) return null;
    const word = match[1]!.toUpperCase();
    verdict = word === 'APPROVED' || word === 'PASSED' ? 'passed' : word === 'BLOCKED' ? 'blocked' : 'failed';
    const summary = synthesis.match(/^##\s*Summary[^\n]*\n+(.{10,400}?)(\n##|\n*$)/ms)?.[1]?.trim().replace(/\s+/g, ' ');
    if (summary) notes = summary;
  } catch {
    return null;
  }

  let headSha: string | undefined;
  try {
    const context = JSON.parse(readFileSync(join(latest.dir, 'context.json'), 'utf-8')) as { headSha?: unknown };
    if (typeof context.headSha === 'string' && context.headSha.length > 0) headSha = context.headSha;
  } catch { /* head is optional evidence */ }

  return { verdict, ...(notes ? { notes } : {}), ...(headSha ? { headSha } : {}), mtimeMs: latest.mtimeMs };
}

