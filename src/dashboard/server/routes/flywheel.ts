/**
 * Flywheel API routes (PAN-709, bead 0e1)
 *
 * GET /api/flywheel/retros           — list non-archived retros with frontmatter summary
 * GET /api/flywheel/retros/:issueId  — full markdown + frontmatter for one issue's retros
 * GET /api/flywheel/report           — FLYWHEEL-REPORT.md content (raw)
 * GET /api/flywheel/daemon/status    — flywheel daemon state
 * GET /api/flywheel/metrics          — aggregated metrics panel data
 * GET /api/flywheel/rollback-preview/:issueId — git revert dry-run diff (read-only)
 *
 * All handlers use fs/promises — ZERO sync calls (CLAUDE.md blocking-call rule).
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { getFlywheelDaemonStatus } from '../../../lib/cloister/flywheel-daemon.js';
import { parseRetroMarkdown } from '../../../lib/flywheel/retro-writer.js';
import { resolveProjectFromIssue } from '../../../lib/projects.js';

const execFileAsync = promisify(execFile);

const RETROS_DIR = join(homedir(), 'docs', 'flywheel', 'retros');
const REPORT_PATH = join(homedir(), 'docs', 'FLYWHEEL-REPORT.md');
const PROVENANCE_INDEX_PATH = join(homedir(), 'docs', 'flywheel', 'provenance-index.json');

// ============================================================================
// Helpers
// ============================================================================

/** Read all non-archived .md files from the retros directory. */
export async function readNonArchivedRetroFiles(): Promise<Array<{ filename: string; content: string }>> {
  let entries: string[];
  try {
    entries = await readdir(RETROS_DIR);
  } catch {
    return [];
  }

  const results: Array<{ filename: string; content: string }> = [];
  for (const entry of entries) {
    if (entry === 'archive') continue;
    if (!entry.endsWith('.md')) continue;
    try {
      const content = await readFile(join(RETROS_DIR, entry), 'utf-8');
      results.push({ filename: entry, content });
    } catch { /* skip */ }
  }
  return results;
}

/** Parse issue ID from retro filename like "PAN-001-1234567890.md" → "PAN-001". */
export function issueIdFromFilename(filename: string): string {
  return filename.replace(/-\d+\.md$/, '').toUpperCase();
}

// ============================================================================
// Route: GET /api/flywheel/retros
// ============================================================================

const getFlywheelRetrosRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/retros',
  httpHandler(Effect.gen(function* () {
    const files = yield* Effect.promise(() => readNonArchivedRetroFiles());

    const retros = files.map(({ filename, content }) => {
      const doc = parseRetroMarkdown(content);
      return {
        filename,
        issueId: issueIdFromFilename(filename),
        surprise: doc?.frontmatter.surprise ?? false,
        frictionScore: doc?.frontmatter.friction_score ?? 0,
        proposedChangesCount: doc?.frontmatter.proposed_changes?.length ?? 0,
      };
    });

    return jsonResponse({ retros, total: retros.length });
  })),
);

// ============================================================================
// Route: GET /api/flywheel/retros/:issueId
// ============================================================================

/** Read provenance index that maps GitHub issue number → triggering retro filenames. */
async function readProvenanceIndex(): Promise<Record<string, string[]>> {
  try {
    const raw = await readFile(PROVENANCE_INDEX_PATH, 'utf-8');
    return JSON.parse(String(raw)) as Record<string, string[]>;
  } catch {
    return {};
  }
}

interface RetroEntry {
  filename: string;
  frictionScore: number;
  summary: string;
  skillName: string;
}

interface RetrosResponse {
  issueId: string;
  retros: RetroEntry[];
  signalCount: number;
  skillName: string;
}

function buildRetroEntry(filename: string, content: string, fallbackSkillName: string): RetroEntry {
  const doc = parseRetroMarkdown(content);
  const firstChange = doc?.frontmatter.proposed_changes?.[0];
  const skillName =
    firstChange && 'name' in firstChange
      ? (firstChange as { name: string }).name
      : firstChange && 'title' in firstChange
      ? (firstChange as { title: string }).title
      : fallbackSkillName;
  return {
    filename,
    frictionScore: doc?.frontmatter.friction_score ?? 0,
    summary: doc?.body.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '',
    skillName,
  };
}

/**
 * Fetch retros for an issue ID. For source issues, matches by filename prefix.
 * For flywheel-change issues (which have no retro files named after them), falls
 * back to the provenance index that was written when the issue was filed.
 * Exported for unit testing.
 */
export async function fetchRetrosForIssueId(issueId: string): Promise<RetrosResponse> {
  const files = await readNonArchivedRetroFiles();
  let matched = files.filter((f) => issueIdFromFilename(f.filename) === issueId);

  // Flywheel-change issues have no retro files named after them — look up the
  // provenance index (written by the daemon when the issue was filed) to find
  // which source-issue retros triggered this flywheel-change.
  if (matched.length === 0) {
    const provenanceIndex = await readProvenanceIndex();
    // issueId may be 'PAN-750', '#750', or '750' — extract the numeric part
    const issueNum = issueId.replace(/^[A-Z]+-/, '').replace(/^#/, '');
    const triggeringFilenames = provenanceIndex[issueNum] ?? [];
    if (triggeringFilenames.length > 0) {
      matched = files.filter((f) => triggeringFilenames.includes(f.filename));
    }
  }

  if (matched.length === 0) {
    return { issueId, retros: [], signalCount: 0, skillName: issueId };
  }

  const retros = matched.map(({ filename, content }) => buildRetroEntry(filename, content, issueId));
  const skillName = retros[0]?.skillName ?? issueId;
  return { issueId, retros, signalCount: retros.length, skillName };
}

const getFlywheelRetroByIssueRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/retros/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = (params['issueId'] ?? '').toUpperCase();
    const result = yield* Effect.promise(() => fetchRetrosForIssueId(issueId));
    return jsonResponse(result);
  })),
);

// ============================================================================
// Route: GET /api/flywheel/report
// ============================================================================

const getFlywheelReportRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/report',
  httpHandler(Effect.gen(function* () {
    let content = '';
    try {
      content = yield* Effect.promise(() => readFile(REPORT_PATH, 'utf-8'));
    } catch {
      content = ''; // Not yet created
    }
    return jsonResponse({ content, path: REPORT_PATH });
  })),
);

// ============================================================================
// Route: GET /api/flywheel/daemon/status
// ============================================================================

const getFlywheelDaemonStatusRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/daemon/status',
  httpHandler(Effect.gen(function* () {
    const status = yield* Effect.sync(() => getFlywheelDaemonStatus());
    return jsonResponse(status);
  })),
);

// ============================================================================
// Route: GET /api/flywheel/metrics
// ============================================================================

/** Pure computation — testable without HTTP infrastructure. */
export function computeFlywheelMetrics(files: Array<{ content: string }>): {
  retrosProcessed: number;
  retrosNoOp: number;
  topPatterns: Array<{ pattern: string; issueCount: number }>;
} {
  let processed = 0;
  let noOp = 0;
  const patternCounts = new Map<string, number>();

  for (const { content } of files) {
    processed++;
    const doc = parseRetroMarkdown(content);
    if (!doc?.frontmatter.surprise) {
      noOp++;
      continue;
    }
    for (const change of doc.frontmatter.proposed_changes ?? []) {
      if (change.type === 'no_op') continue;
      const pattern = 'name' in change ? (change as { name: string }).name : '';
      if (pattern) {
        patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1);
      }
    }
  }

  const topPatterns = Array.from(patternCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pattern, issueCount]) => ({ pattern, issueCount }));

  return { retrosProcessed: processed, retrosNoOp: noOp, topPatterns };
}

const getFlywheelMetricsRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/metrics',
  httpHandler(Effect.gen(function* () {
    const files = yield* Effect.promise(() => readNonArchivedRetroFiles());
    return jsonResponse(computeFlywheelMetrics(files));
  })),
);

// ============================================================================
// Route: GET /api/flywheel/rollback-preview/:issueId
// ============================================================================

/**
 * Resolve the repository directory for a flywheel-change issue.
 * Flywheel-change issues are implemented on feature branches in the project repo,
 * not in ~/docs. Falls back to cwd() when the project cannot be resolved.
 * Exported for unit testing.
 */
export function resolveRollbackRepoDir(issueId: string): string {
  const project = resolveProjectFromIssue(issueId);
  return project?.projectPath ?? process.cwd();
}

/**
 * Returns the raw output of `git diff commitSha commitSha^`, which is already
 * a correct revert preview (changes needed to go from the commit back to its
 * parent). Exported for unit-testing the no-inversion contract.
 */
export function buildRollbackPreviewDiff(rawDiff: string): string {
  return rawDiff;
}

const getRollbackPreviewRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/rollback-preview/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = (params['issueId'] ?? '').toUpperCase();

    // Find the most recent commit for this flywheel-change issue
    // Convention: commit message contains the issue ID
    const repoDir = resolveRollbackRepoDir(issueId);
    let commitSha = '';
    let diff = '';
    try {
      const { stdout: logOut } = yield* Effect.promise(() =>
        execFileAsync('git', [
          '-C', repoDir,
          'log', '--oneline', '--grep', issueId,
          '-1',
        ])
      );
      const shaMatch = logOut.trim().match(/^([0-9a-f]{7,40})/);
      if (shaMatch) {
        commitSha = shaMatch[1];
        // Produce a revert preview diff (read-only, does not modify working tree)
        const { stdout: diffOut } = yield* Effect.promise(() =>
          execFileAsync('git', [
            '-C', repoDir,
            'diff', commitSha, `${commitSha}^`,
          ])
        );
        diff = buildRollbackPreviewDiff(diffOut);
      }
    } catch {
      // No commit found or git error — return empty diff
    }

    return jsonResponse({ issueId, commitSha, diff });
  })),
);

// ============================================================================
// Route layer
// ============================================================================

export const flywheelRouteLayer = Layer.mergeAll(
  getFlywheelRetrosRoute,
  getFlywheelRetroByIssueRoute,
  getFlywheelReportRoute,
  getFlywheelDaemonStatusRoute,
  getFlywheelMetricsRoute,
  getRollbackPreviewRoute,
);

export default flywheelRouteLayer;
