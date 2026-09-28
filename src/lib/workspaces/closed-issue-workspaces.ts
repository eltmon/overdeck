/**
 * Closed-issue workspace disk report and cleanup (PAN-4283).
 *
 * Server-reachable — never imports src/cli (D11). Duplicates the ~10-line
 * `dirSizeBytes` body from src/cli/commands/workspace-list.ts rather than
 * sharing it, to keep the server/CLI boundary intact.
 */

import { execFile } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { withGitHubCaller } from '../github-quota/caller-context.js';
import { isTrackerIssueClosed } from '../cloister/issue-closed.js';
import { readActivePause } from '../github-quota/pause-gate.js';
import { listProjectsSync } from '../projects.js';
import { resolveIssueWorkspaceDirs } from './shapes.js';

const execFileAsync = promisify(execFile);

const WORKSPACE_ISSUE_DIR_PATTERN = /^feature-([a-z][a-z0-9]*-\d+)(?:-strike|-slot-\d+)?$/i;

export interface ClosedIssueWorkspaceRow {
  issueId: string;
  projectKey: string;
  projectPath: string;
  polyrepo: boolean;
  paths: string[];
  sizeBytes: number | null;
}

export interface ClosedIssueWorkspaceReport {
  closedCount: number;
  totalBytes: number;
  unknownSizeCount: number;
  trackerReadsPaused: boolean;
  rows: ClosedIssueWorkspaceRow[];
  computedAt: string;
}

export interface ClosedIssueWorkspaceDeps {
  listProjects: () => Array<{ key: string; config: { path: string; workspace?: { type?: string; workspaces_dir?: string } } }>;
  isClosed: (issueId: string) => Promise<boolean>;
  dirSize: (path: string) => Promise<number | null>;
  isTrackerPaused: () => boolean;
  now: () => Date;
}

async function dirSizeBytes(path: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('du', ['-sb', path], { encoding: 'utf-8' });
    const parsed = parseInt(stdout.trim().split(/\s/)[0] ?? '', 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const DEFAULT_DEPS: ClosedIssueWorkspaceDeps = {
  listProjects: listProjectsSync,
  isClosed: (issueId) => withGitHubCaller('close-out', () => isTrackerIssueClosed(issueId)),
  dirSize: dirSizeBytes,
  isTrackerPaused: () => readActivePause().length > 0,
  now: () => new Date(),
};

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

const REPORT_CACHE_MS = 60_000;
let cachedReport: { report: ClosedIssueWorkspaceReport; computedAtMs: number } | null = null;

/** Clears the 60s default-deps report cache. Call after a cleanup so the next read reflects it. */
export function clearClosedIssueWorkspaceCache(): void {
  cachedReport = null;
}

function issueWorkspaceRows(
  key: string,
  path: string,
  workspaceType: string | undefined,
  workspacesDirName: string | undefined,
): Array<{ issueLower: string; workspacesDir: string; polyrepo: boolean }> {
  const workspacesDir = join(path, workspacesDirName || 'workspaces');
  const polyrepo = workspaceType === 'polyrepo';
  if (!existsSync(workspacesDir)) return [];

  let entries: string[] = [];
  try {
    entries = readdirSync(workspacesDir);
  } catch {
    return [];
  }

  const issueLowerSet = new Set<string>();
  for (const entry of entries) {
    const match = WORKSPACE_ISSUE_DIR_PATTERN.exec(entry);
    if (match?.[1]) issueLowerSet.add(match[1].toLowerCase());
  }
  return Array.from(issueLowerSet).map((issueLower) => ({ issueLower, workspacesDir, polyrepo }));
}

export async function collectClosedIssueWorkspaces(
  deps?: Partial<ClosedIssueWorkspaceDeps>
): Promise<ClosedIssueWorkspaceReport> {
  const useCache = !deps;
  if (useCache && cachedReport && Date.now() - cachedReport.computedAtMs < REPORT_CACHE_MS) {
    return cachedReport.report;
  }

  const resolved: ClosedIssueWorkspaceDeps = { ...DEFAULT_DEPS, ...deps };
  const projects = resolved.listProjects();

  const candidates = projects.flatMap(({ key, config }) =>
    issueWorkspaceRows(key, config.path, config.workspace?.type, config.workspace?.workspaces_dir).map((c) => ({
      ...c,
      projectKey: key,
      projectPath: config.path,
    }))
  );

  const closedFlags = await Promise.all(
    candidates.map((c) => resolved.isClosed(c.issueLower.toUpperCase()))
  );
  const closedCandidates = candidates.filter((_, i) => closedFlags[i]);

  const rows = await mapWithConcurrency(closedCandidates, 4, async (c) => {
    const paths = resolveIssueWorkspaceDirs(c.workspacesDir, c.issueLower).map((d) => d.path);
    const sizes = await Promise.all(paths.map((p) => resolved.dirSize(p)));
    const sizeBytes = sizes.some((s) => s === null) ? null : sizes.reduce((a, b) => (a ?? 0) + (b ?? 0), 0);
    const row: ClosedIssueWorkspaceRow = {
      issueId: c.issueLower.toUpperCase(),
      projectKey: c.projectKey,
      projectPath: c.projectPath,
      polyrepo: c.polyrepo,
      paths,
      sizeBytes,
    };
    return row;
  });

  const report: ClosedIssueWorkspaceReport = {
    closedCount: rows.length,
    totalBytes: rows.reduce((sum, row) => sum + (row.sizeBytes ?? 0), 0),
    unknownSizeCount: rows.filter((row) => row.sizeBytes === null).length,
    trackerReadsPaused: resolved.isTrackerPaused(),
    rows,
    computedAt: resolved.now().toISOString(),
  };

  if (useCache) {
    cachedReport = { report, computedAtMs: Date.now() };
  }
  return report;
}
