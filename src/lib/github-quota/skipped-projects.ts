/**
 * PAN-4264: projects whose tracker cannot be resolved from projects.yaml.
 *
 * Membership refresh skips them instead of failing (and logging) on every
 * refresh. The skip is logged once per project per projects.yaml mtime, so
 * editing projects.yaml re-announces it, and the current list is written to
 * `~/.overdeck/github-quota/skipped-projects.json` for `pan doctor
 * github-quota`. Plain `pan doctor` computes the same predicate itself.
 */

import { readFileSync, statSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOverdeckHome } from '../paths.js';
import { getGitHubQuotaDir } from './ledger.js';

export interface SkippedProjectRecord {
  name: string;
  path: string;
}

const skipped = new Map<string, SkippedProjectRecord>();
const loggedAtMtime = new Map<string, number>();

function skippedProjectsFile(): string {
  return join(getGitHubQuotaDir(), 'skipped-projects.json');
}

function projectsYamlMtimeMs(): number {
  try {
    return statSync(join(getOverdeckHome(), 'projects.yaml')).mtimeMs;
  } catch {
    return 0;
  }
}

async function persist(records: SkippedProjectRecord[]): Promise<void> {
  const file = skippedProjectsFile();
  await mkdir(getGitHubQuotaDir(), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ updatedAt: new Date().toISOString(), projects: records }, null, 2)}\n`);
  await rename(tmp, file);
}

/**
 * Record whether a membership refresh skipped `project` for having no
 * resolvable tracker. Logs a newly skipped project once per projects.yaml
 * mtime and rewrites the skipped list when it changed. Never throws.
 */
export function recordMembershipTrackerSkip(project: { name?: string; path: string }, isSkipped: boolean): void {
  try {
    let changed = false;
    if (isSkipped) {
      const name = project.name ?? project.path;
      const mtime = projectsYamlMtimeMs();
      if (loggedAtMtime.get(project.path) !== mtime) {
        loggedAtMtime.set(project.path, mtime);
        console.log(`[resource-discovery] skipping membership for ${name}: no tracker configured (set tracker: or issue_prefix: in projects.yaml)`);
      }
      if (!skipped.has(project.path)) {
        skipped.set(project.path, { name, path: project.path });
        changed = true;
      }
    } else if (skipped.delete(project.path)) {
      loggedAtMtime.delete(project.path);
      changed = true;
    }
    if (changed) void persist([...skipped.values()]).catch(() => undefined);
  } catch {
    // NFR-2: bookkeeping never fails the refresh.
  }
}

/** The skipped list the dashboard last wrote; empty when none. Sync, bounded. */
export function readSkippedProjects(): SkippedProjectRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(skippedProjectsFile(), 'utf8')) as { projects?: unknown };
    if (!Array.isArray(parsed.projects)) return [];
    return parsed.projects.filter((p): p is SkippedProjectRecord =>
      !!p && typeof (p as SkippedProjectRecord).name === 'string' && typeof (p as SkippedProjectRecord).path === 'string');
  } catch {
    return [];
  }
}

/** Forget the in-memory skip state (tests only). */
export function resetSkippedProjectsForTests(): void {
  skipped.clear();
  loggedAtMtime.clear();
}
