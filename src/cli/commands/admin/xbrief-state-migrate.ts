import { execFile } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { Effect } from 'effect';

import { flushAutoCommits, queueAutoCommit } from '../../../lib/pan-dir/auto-commit.js';
import { getProjectSync, type ProjectConfig } from '../../../lib/projects.js';
import { MIGRATION_COMPLETE_MARKER, STATE_BRANCH, stateWorktreePath } from '../../../lib/state-home.js';
import {
  LEGACY_VBRIEF_FILENAME_SUFFIX,
  XBRIEF_FILENAME_SUFFIX,
} from '../../../lib/xbrief/lifecycle.js';

const execFileAsync = promisify(execFile);

interface RewriteOperation {
  path: string;
  content: string;
}

interface RenameOperation {
  from: string;
  to: string;
}

export interface XBriefStateMigrationPlan {
  rewrites: RewriteOperation[];
  renames: RenameOperation[];
  files: string[];
}

export interface XBriefStateMigrationResult {
  dryRun: boolean;
  filesMigrated: number;
  committed: boolean;
}

function canonicalPath(path: string): string {
  return `${path.slice(0, -LEGACY_VBRIEF_FILENAME_SUFFIX.length)}${XBRIEF_FILENAME_SUFFIX}`;
}

function migratedSpecContent(path: string): string | null {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('expected a JSON object');
    }
    parsed = value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Cannot migrate invalid xBRIEF JSON at ${path}: ${String(error)}`);
  }

  if (!Object.hasOwn(parsed, 'vBRIEFInfo')) return null;
  if (Object.hasOwn(parsed, 'xBRIEFInfo')) {
    if (JSON.stringify(parsed.xBRIEFInfo) !== JSON.stringify(parsed.vBRIEFInfo)) {
      throw new Error(`Cannot migrate conflicting vBRIEFInfo and xBRIEFInfo envelopes at ${path}`);
    }
    delete parsed.vBRIEFInfo;
    return `${JSON.stringify(parsed, null, 2)}\n`;
  }

  const { vBRIEFInfo, ...document } = parsed;
  return `${JSON.stringify({ xBRIEFInfo: vBRIEFInfo, ...document }, null, 2)}\n`;
}

function planDirectoryRenames(directory: string, renames: RenameOperation[], files: Set<string>): void {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith(LEGACY_VBRIEF_FILENAME_SUFFIX)) continue;
    const from = join(directory, entry.name);
    const to = canonicalPath(from);
    if (existsSync(to)) {
      throw new Error(`Cannot migrate ${from}: destination already exists at ${to}`);
    }
    renames.push({ from, to });
    files.add(from);
  }
}

export function planXBriefStateMigration(stateRoot: string): XBriefStateMigrationPlan {
  const specsDir = join(stateRoot, 'specs');
  const continuesDir = join(stateRoot, 'continues');
  const rewrites: RewriteOperation[] = [];
  const renames: RenameOperation[] = [];
  const files = new Set<string>();

  if (existsSync(specsDir)) {
    for (const entry of readdirSync(specsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const path = join(specsDir, entry.name);
      const content = migratedSpecContent(path);
      if (content !== null) {
        rewrites.push({ path, content });
        files.add(path);
      }
    }
  }

  planDirectoryRenames(specsDir, renames, files);
  planDirectoryRenames(continuesDir, renames, files);

  return {
    rewrites,
    renames,
    files: [...files].sort(),
  };
}

async function assertCleanStateWorktree(stateRoot: string): Promise<void> {
  if (!existsSync(join(stateRoot, '.git'))) {
    throw new Error(`State worktree is missing at ${stateRoot}`);
  }
  if (!existsSync(join(stateRoot, MIGRATION_COMPLETE_MARKER))) {
    throw new Error(`State worktree is not migration-complete: ${stateRoot}`);
  }

  const { stdout: branch } = await execFileAsync('git', ['branch', '--show-current'], {
    cwd: stateRoot,
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (branch.trim() !== STATE_BRANCH) {
    throw new Error(`Expected ${STATE_BRANCH} at ${stateRoot}, found ${branch.trim() || 'detached HEAD'}`);
  }

  const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], {
    cwd: stateRoot,
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (status.trim()) {
    throw new Error(`State worktree is dirty; commit or resolve existing changes before xBRIEF migration:\n${status.trim()}`);
  }
}

function printPlan(projectKey: string, stateRoot: string, plan: XBriefStateMigrationPlan): void {
  console.log(`xBRIEF state migration plan for ${projectKey}:`);
  for (const rewrite of plan.rewrites) {
    console.log(`  rewrite ${relative(stateRoot, rewrite.path)}: vBRIEFInfo -> xBRIEFInfo`);
  }
  for (const rename of plan.renames) {
    console.log(`  rename ${relative(stateRoot, rename.from)} -> ${relative(stateRoot, rename.to)}`);
  }
  console.log(`  ${plan.files.length} file(s) to migrate`);
}

export async function migrateProjectXBriefState(
  projectKey: string,
  options: { dryRun?: boolean } = {},
  projectOverride?: ProjectConfig,
): Promise<XBriefStateMigrationResult> {
  const project = projectOverride ?? getProjectSync(projectKey);
  if (!project) throw new Error(`Unknown project: ${projectKey}`);
  const stateRoot = stateWorktreePath(project, { projectKey });

  await assertCleanStateWorktree(stateRoot);
  const plan = planXBriefStateMigration(stateRoot);
  printPlan(projectKey, stateRoot, plan);

  if (options.dryRun || plan.files.length === 0) {
    return {
      dryRun: options.dryRun === true,
      filesMigrated: plan.files.length,
      committed: false,
    };
  }

  for (const rewrite of plan.rewrites) writeFileSync(rewrite.path, rewrite.content);
  for (const rename of plan.renames) renameSync(rename.from, rename.to);

  const paths = new Set<string>();
  for (const rewrite of plan.rewrites) paths.add(rewrite.path);
  for (const rename of plan.renames) {
    paths.add(rename.from);
    paths.add(rename.to);
  }
  queueAutoCommit({
    projectRoot: project.path,
    repoRoot: stateRoot,
    paths: [...paths],
    subject: 'chore(state): migrate xBRIEF documents (PAN-2829)',
  });
  const flush = await Effect.runPromise(flushAutoCommits(project.path));
  if (flush.errored || !flush.committed || flush.pushed === false) {
    throw new Error(`xBRIEF state migration commit failed: ${flush.reason ?? 'state writer did not commit and push'}`);
  }

  console.log(`Migrated ${plan.files.length} xBRIEF state file(s) in one commit.`);
  return {
    dryRun: false,
    filesMigrated: plan.files.length,
    committed: true,
  };
}
