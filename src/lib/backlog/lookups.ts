import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getReviewStatusSync } from '../review-status.js';
import type { ClassifyLookups } from './pickup.js';

/**
 * Build the {@link ClassifyLookups} the shared pickup module needs from live project
 * state: labels (in-memory issue service), planned (vBRIEF spec + beads), and
 * in-pipeline (review status / live workspace). Shared by the dashboard forecast
 * route and the Flywheel run-cohort snapshot so both classify issues identically
 * (PAN-2006 single source of truth). The issue service is lazy-required to avoid a
 * static lib → dashboard layering edge.
 */
export function buildClassifyLookups(
  projectRoot: string,
  opts?: { labels?: (id: string) => readonly string[] },
): ClassifyLookups {
  // Labels come from the in-memory issue service (server-side). A CLI/sandbox process cannot
  // reach that singleton, so callers there must pass `opts.labels` (e.g. gh-derived) — without
  // it, a CLI would silently classify every issue as label-less, making ready/released/parked/
  // objection/vetoed/blocksMain all false (the `pan backlog forecast` undercount bug).
  const labelsByIssue = new Map<string, string[]>();
  if (!opts?.labels) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSharedIssueService } = require('../../dashboard/server/services/issue-service-singleton.js') as typeof import('../../dashboard/server/services/issue-service-singleton.js');
      for (const issue of getSharedIssueService().getIssues() as Array<Record<string, unknown>>) {
        const id = typeof issue['identifier'] === 'string' ? issue['identifier'].toUpperCase() : '';
        if (!id) continue;
        const raw = Array.isArray(issue['labels']) ? (issue['labels'] as unknown[]) : [];
        const names = raw
          .map((l) => (typeof l === 'string' ? l : ((l as { name?: string })?.name ?? '')))
          .filter((s): s is string => Boolean(s));
        labelsByIssue.set(id, names);
      }
    } catch { /* issue service not ready — treat as no labels */ }
  }

  const specsDir = join(projectRoot, '.pan', 'specs');
  const specIssues = new Set<string>();
  if (existsSync(specsDir)) {
    for (const f of readdirSync(specsDir)) {
      const m = /^[\d-]+-([A-Z]+-\d+)-/i.exec(f);
      if (m) specIssues.add(m[1]!.toUpperCase());
    }
  }
  const workspacesDir = join(projectRoot, 'workspaces');
  const beadsIssues = new Set<string>();
  if (existsSync(workspacesDir)) {
    for (const dir of readdirSync(workspacesDir)) {
      const m = /^feature-([a-z]+-\d+)$/i.exec(dir);
      if (m && existsSync(join(workspacesDir, dir, '.beads', 'issues.jsonl'))) beadsIssues.add(m[1]!.toUpperCase());
    }
  }

  return {
    labels: opts?.labels ?? ((id) => labelsByIssue.get(id.toUpperCase()) ?? []),
    isPlanned: (id) => {
      const u = id.toUpperCase();
      return specIssues.has(u) && beadsIssues.has(u);
    },
    isInPipeline: (id) => {
      const u = id.toUpperCase();
      const rs = getReviewStatusSync(u);
      return (rs !== null && rs.reviewStatus !== 'pending') || existsSync(join(workspacesDir, `feature-${id.toLowerCase()}`));
    },
  };
}
