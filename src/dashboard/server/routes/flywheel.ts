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

import { promises as fsPromises } from 'node:fs';
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

const execFileAsync = promisify(execFile);

const RETROS_DIR = join(homedir(), 'docs', 'flywheel', 'retros');
const REPORT_PATH = join(homedir(), 'docs', 'FLYWHEEL-REPORT.md');

// ============================================================================
// Helpers
// ============================================================================

/** Read all non-archived .md files from the retros directory. */
async function readNonArchivedRetroFiles(): Promise<Array<{ filename: string; content: string }>> {
  let entries: string[];
  try {
    entries = await fsPromises.readdir(RETROS_DIR);
  } catch {
    return [];
  }

  const results: Array<{ filename: string; content: string }> = [];
  for (const entry of entries) {
    if (entry === 'archive') continue;
    if (!entry.endsWith('.md')) continue;
    try {
      const content = await fsPromises.readFile(join(RETROS_DIR, entry), 'utf-8');
      results.push({ filename: entry, content });
    } catch { /* skip */ }
  }
  return results;
}

/** Parse skill name from retro title like "PAN-001-1234567890.md" → "PAN-001". */
function issueIdFromFilename(filename: string): string {
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

const getFlywheelRetroByIssueRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/retros/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = (params['issueId'] ?? '').toUpperCase();

    const files = yield* Effect.promise(() => readNonArchivedRetroFiles());
    const matched = files.filter(
      (f) => issueIdFromFilename(f.filename) === issueId,
    );

    if (matched.length === 0) {
      return jsonResponse({ retros: [], signalCount: 0, skillName: issueId, issueId });
    }

    const retros = matched.map(({ filename, content }) => {
      const doc = parseRetroMarkdown(content);
      const firstChange = doc?.frontmatter.proposed_changes?.[0];
      const skillName =
        firstChange && 'name' in firstChange
          ? (firstChange as { name: string }).name
          : firstChange && 'title' in firstChange
          ? (firstChange as { title: string }).title
          : issueId;
      return {
        filename,
        frictionScore: doc?.frontmatter.friction_score ?? 0,
        summary: doc?.body.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '',
        skillName,
      };
    });

    const skillName = retros[0]?.skillName ?? issueId;

    return jsonResponse({
      issueId,
      retros,
      signalCount: retros.length,
      skillName,
    });
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
      content = yield* Effect.promise(() => fsPromises.readFile(REPORT_PATH, 'utf-8'));
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

const getFlywheelMetricsRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/metrics',
  httpHandler(Effect.gen(function* () {
    const files = yield* Effect.promise(() => readNonArchivedRetroFiles());

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

    // Skills-added/refined come from the flywheel report (placeholder counts for now)
    return jsonResponse({
      skillsAdded: { week: 0, month: 0, allTime: 0 },
      skillsRefined: { week: 0, month: 0, allTime: 0 },
      retrosProcessed: processed,
      retrosNoOp: noOp,
      topPatterns,
    });
  })),
);

// ============================================================================
// Route: GET /api/flywheel/rollback-preview/:issueId
// ============================================================================

const getRollbackPreviewRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/rollback-preview/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = (params['issueId'] ?? '').toUpperCase();

    // Find the most recent commit for this flywheel-change issue
    // Convention: commit message contains the issue ID
    let commitSha = '';
    let diff = '';
    try {
      const { stdout: logOut } = yield* Effect.promise(() =>
        execFileAsync('git', [
          '-C', join(homedir(), 'docs'),
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
            '-C', join(homedir(), 'docs'),
            'diff', `${commitSha}^`, commitSha,
          ])
        );
        // Invert the diff to show what a revert would produce
        diff = diffOut
          .split('\n')
          .map((line) => {
            if (line.startsWith('+') && !line.startsWith('+++')) return `-${line.slice(1)}`;
            if (line.startsWith('-') && !line.startsWith('---')) return `+${line.slice(1)}`;
            return line;
          })
          .join('\n');
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
