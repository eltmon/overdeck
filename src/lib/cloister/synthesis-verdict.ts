/**
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
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { resolveProjectFromIssueSync } from '../projects.js';
import {
  findVerdictReport,
  parseVerdictReport,
  type ReviewVerdict,
} from './review-verdict-report.js';

export interface SynthesisArtifactVerdict {
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
  options: { now?: number; workspacePath?: string } = {},
): SynthesisArtifactVerdict | null {
  const now = options.now ?? Date.now();
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

  // Newest run dir by artifact mtime carrying EITHER verdict artifact shape.
  let latest: { dir: string; mtimeMs: number; content: string } | null = null;
  try {
    for (const entry of readdirSync(reviewRoot)) {
      const runDir = join(reviewRoot, entry);
      const report = findVerdictReport(runDir);
      if (!report) continue;
      const mtimeMs = statSync(report.path).mtimeMs;
      if (!latest || mtimeMs > latest.mtimeMs) {
        latest = { dir: runDir, mtimeMs, content: readFileSync(report.path, 'utf-8') };
      }
    }
  } catch {
    return null;
  }
  if (!latest || now - latest.mtimeMs > SYNTHESIS_ARTIFACT_FRESH_MS) return null;

  const parsed = parseVerdictReport(latest.content);
  if (!parsed) return null;
  const notes = readNotes(latest.content, parsed.topBlocker);
  const headSha = readHeadEvidence(latest.dir);

  return {
    verdict: parsed.verdict,
    ...(notes ? { notes } : {}),
    ...(headSha ? { headSha } : {}),
    mtimeMs: latest.mtimeMs,
  };
}
