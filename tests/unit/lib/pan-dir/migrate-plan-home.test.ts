/**
 * PAN-3917 W1 (w1-plan-home): the state-worktree → `.pan/` migration copies
 * per-issue artifacts for OPEN issues only, always copies the project-wide
 * ones, carries `records/` item-status overrides into `.pan/continues/`, and
 * is idempotent. Ported from `tests/unit/scripts/migrate-pan-home.test.ts`
 * plus new coverage for item-progress copying and `--dry-run`.
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MIGRATION_COMMIT_SUBJECT,
  MigratePlanHomeError,
  PlanHomeGitError,
  destinationName,
  issueIdForArtifact,
  migratePanHome,
  readOpenIssuesFile,
} from '../../../../src/lib/pan-dir/migrate-plan-home.js';

let root: string;
let stateRoot: string;
let planHome: string;

function write(base: string, rel: string, content: string): void {
  const path = join(base, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function writeJson(base: string, rel: string, value: unknown): void {
  write(base, rel, `${JSON.stringify(value, null, 2)}\n`);
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function initGit(cwd: string): void {
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'test@overdeck.local');
  git(cwd, 'config', 'user.name', 'Overdeck Test');
  git(cwd, 'config', 'commit.gpgsign', 'false');
}

beforeEach(() => {
  // realpath: git reports rule sources under the resolved repo root.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'migrate-plan-home-')));
  stateRoot = join(root, 'state');
  planHome = join(root, 'repo');
  mkdirSync(planHome, { recursive: true });

  write(stateRoot, 'drafts/pan-100.md', '# open draft\n');
  write(stateRoot, 'drafts/pan-200.md', '# closed draft\n');
  write(stateRoot, 'specs/2026-01-01-PAN-100-open.xbrief.json', '{"open":true}\n');
  write(stateRoot, 'specs/2026-01-01-PAN-200-closed.xbrief.json', '{"open":false}\n');
  // State-worktree continues carry the legacy lowercase `.vbrief.json` name.
  write(stateRoot, 'continues/pan-100.vbrief.json', '{"version":"1","issueId":"PAN-100","created":"2026-01-01T00:00:00.000Z","updated":"2026-01-01T00:00:00.000Z","gitState":{},"decisions":[],"hazards":[],"resumePoint":null,"sessionHistory":[]}\n');
  write(stateRoot, 'continues/pan-200.vbrief.json', '{"issueId":"PAN-200"}\n');
  write(stateRoot, 'orders/index.json', '[]\n');
  write(stateRoot, 'orders/2026-01-01-wave.json', '{"id":"2026-01-01-wave"}\n');
  write(stateRoot, 'notes/retro.md', 'notes\n');
  write(stateRoot, 'backlog/sequence.md', '# Backlog Sequence\n');
  writeJson(stateRoot, 'records/pan-100.json', {
    issueId: 'PAN-100',
    statusOverrides: { 'item-a': 'completed', 'item-a.ac1': 'completed', 'item-b': 'in_progress' },
  });
  writeJson(stateRoot, 'records/pan-200.json', {
    issueId: 'PAN-200',
    statusOverrides: { 'item-z': 'completed' },
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const OPEN = ['PAN-100'];

describe('issueIdForArtifact', () => {
  it('reads the issue out of each per-issue filename shape', () => {
    expect(issueIdForArtifact('drafts', 'pan-100.md')).toBe('PAN-100');
    expect(issueIdForArtifact('specs', '2026-01-01-PAN-100-open.xbrief.json')).toBe('PAN-100');
    expect(issueIdForArtifact('continues', 'PAN-100.xbrief.json')).toBe('PAN-100');
    expect(issueIdForArtifact('continues', 'pan-100.vbrief.json')).toBe('PAN-100');
    expect(issueIdForArtifact('drafts', 'README.md')).toBeNull();
  });

  it('renames a legacy continue file to the name the continue door reads', () => {
    expect(destinationName('continues', 'pan-100.vbrief.json', 'PAN-100')).toBe('PAN-100.xbrief.json');
    expect(destinationName('drafts', 'pan-100.md', 'PAN-100')).toBe('pan-100.md');
  });
});

describe('migratePanHome', () => {
  it('copies open-issue artifacts and leaves closed-issue ones behind', async () => {
    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });

    const panDir = join(planHome, '.pan');
    expect(existsSync(join(panDir, 'drafts/pan-100.md'))).toBe(true);
    expect(existsSync(join(panDir, 'specs/2026-01-01-PAN-100-open.xbrief.json'))).toBe(true);
    // Renamed to the shape continueStatePath reads.
    expect(existsSync(join(panDir, 'continues/PAN-100.xbrief.json'))).toBe(true);
    expect(existsSync(join(panDir, 'continues/pan-100.vbrief.json'))).toBe(false);

    expect(existsSync(join(panDir, 'drafts/pan-200.md'))).toBe(false);
    expect(existsSync(join(panDir, 'specs/2026-01-01-PAN-200-closed.xbrief.json'))).toBe(false);
    expect(existsSync(join(panDir, 'continues/PAN-200.xbrief.json'))).toBe(false);
    expect(existsSync(join(panDir, 'continues/pan-200.vbrief.json'))).toBe(false);

    expect(result.skippedClosed).toBe(3);
    expect(result.remaining).toBe(0);
  });

  it('always copies orders, notes, and the backlog sequence', async () => {
    await migratePanHome({ stateRoot, planHome, openIssues: [] });
    const panDir = join(planHome, '.pan');
    expect(readFileSync(join(panDir, 'orders/index.json'), 'utf8')).toBe('[]\n');
    expect(existsSync(join(panDir, 'orders/2026-01-01-wave.json'))).toBe(true);
    expect(existsSync(join(panDir, 'notes/retro.md'))).toBe(true);
    expect(existsSync(join(panDir, 'backlog/sequence.md'))).toBe(true);
  });

  it('never brings the record plane across', async () => {
    await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    expect(existsSync(join(planHome, '.pan', 'records'))).toBe(false);
  });

  it('skips a dangling symlink instead of copying or erroring', async () => {
    symlinkSync(join(stateRoot, 'drafts', 'does-not-exist.md'), join(stateRoot, 'drafts', 'pan-101.md'));
    const result = await migratePanHome({ stateRoot, planHome, openIssues: [...OPEN, 'PAN-101'] });
    expect(existsSync(join(planHome, '.pan', 'drafts', 'pan-101.md'))).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('is idempotent — a second run copies nothing and reports 0 remaining', async () => {
    const first = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    expect(first.copied.length).toBeGreaterThan(0);

    const second = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    expect(second.copied).toEqual([]);
    expect(second.unchanged).toBe(first.copied.length);
    expect(second.remaining).toBe(0);
    expect(second.progressUpdated).toEqual([]);
  });

  it('re-copies a source file that changed after the first run', async () => {
    await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    write(stateRoot, 'drafts/pan-100.md', '# revised\n');

    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    expect(result.copied).toEqual(['drafts/pan-100.md']);
    expect(readFileSync(join(planHome, '.pan/drafts/pan-100.md'), 'utf8')).toBe('# revised\n');
  });

  it('creates the continue file and merges item progress from records/ statusOverrides', async () => {
    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });

    expect(result.progressUpdated).toEqual(['PAN-100']);
    const dest = JSON.parse(readFileSync(join(planHome, '.pan/continues/PAN-100.xbrief.json'), 'utf8'));
    // Legacy continue fields carried across from the source file.
    expect(dest.issueId).toBe('PAN-100');
    expect(dest.version).toBe('1');
    // Statuses are carried verbatim — `completed` is the xBRIEF item-status
    // value, so translating it would hide the item from the overlay and the DAG.
    expect(dest.items['item-a']).toEqual({ status: 'completed', migratedFrom: 'records.statusOverrides' });
    expect(dest.items['item-a.ac1']).toEqual({ status: 'completed', migratedFrom: 'records.statusOverrides' });
    expect(dest.items['item-b']).toEqual({ status: 'in_progress', migratedFrom: 'records.statusOverrides' });
    // The closed issue's overrides never land, even though its record exists.
    expect(existsSync(join(planHome, '.pan/continues/PAN-200.xbrief.json'))).toBe(false);
  });

  it('creates a continue file from records/ overrides alone when there is no source continue file', async () => {
    rmSync(join(stateRoot, 'continues/pan-100.vbrief.json'));
    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    expect(result.progressUpdated).toEqual(['PAN-100']);
    const dest = JSON.parse(readFileSync(join(planHome, '.pan/continues/PAN-100.xbrief.json'), 'utf8'));
    expect(dest.issueId).toBe('PAN-100');
    expect(dest.items['item-a'].status).toBe('completed');
  });

  it('reads statusOverrides nested under tasks, falling back from the top-level field', async () => {
    writeJson(stateRoot, 'records/pan-100.json', {
      issueId: 'PAN-100',
      tasks: { statusOverrides: { 'item-c': 'completed' } },
    });
    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    expect(result.progressUpdated).toEqual(['PAN-100']);
    const dest = JSON.parse(readFileSync(join(planHome, '.pan/continues/PAN-100.xbrief.json'), 'utf8'));
    expect(dest.items['item-c']).toEqual({ status: 'completed', migratedFrom: 'records.statusOverrides' });
  });

  it('is idempotent for progress-merged continue files — a second run reports no change', async () => {
    const first = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    expect(first.progressUpdated).toEqual(['PAN-100']);
    const firstWrite = readFileSync(join(planHome, '.pan/continues/PAN-100.xbrief.json'), 'utf8');

    const second = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    expect(second.copied).toEqual([]);
    expect(second.progressUpdated).toEqual([]);
    expect(second.remaining).toBe(0);
    // Only volatile `updated` may differ; everything else (including items) is unchanged.
    const secondWrite = JSON.parse(readFileSync(join(planHome, '.pan/continues/PAN-100.xbrief.json'), 'utf8'));
    const firstParsed = JSON.parse(firstWrite);
    expect(secondWrite.items).toEqual(firstParsed.items);
  });

  it('merges a later status change into the existing items map without clobbering other items', async () => {
    await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    writeJson(stateRoot, 'records/pan-100.json', {
      issueId: 'PAN-100',
      statusOverrides: { 'item-b': 'completed' },
    });

    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    expect(result.progressUpdated).toEqual(['PAN-100']);
    const dest = JSON.parse(readFileSync(join(planHome, '.pan/continues/PAN-100.xbrief.json'), 'utf8'));
    expect(dest.items['item-a'].status).toBe('completed');
    expect(dest.items['item-b'].status).toBe('completed');
  });

  it('--dry-run reports what would be copied and writes nothing', async () => {
    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN, dryRun: true });

    expect(result.copied.length).toBeGreaterThan(0);
    expect(result.progressUpdated).toEqual(['PAN-100']);
    expect(result.committed).toBe(false);
    expect(existsSync(join(planHome, '.pan'))).toBe(false);
  });

  it('does not commit without --commit', async () => {
    initGit(planHome);

    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    expect(result.committed).toBe(false);
    expect(git(planHome, 'status', '--porcelain')).toContain('.pan/');
  });

  it('commits the copied artifacts with the mandated subject when asked', async () => {
    initGit(planHome);

    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN, commit: true });
    expect(result.committed).toBe(true);
    expect(git(planHome, 'log', '-1', '--format=%s').trim()).toBe(MIGRATION_COMMIT_SUBJECT);
    expect(git(planHome, 'status', '--porcelain').trim()).toBe('');
  });

  it('--commit leaves a pre-staged unrelated change staged and out of the commit', async () => {
    initGit(planHome);
    write(planHome, 'unrelated.txt', 'operator work in progress\n');
    git(planHome, 'add', '--', 'unrelated.txt');

    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN, commit: true });

    expect(result.committed).toBe(true);
    expect(git(planHome, 'show', '--name-only', '--format=', 'HEAD')).not.toContain('unrelated.txt');
    expect(git(planHome, 'diff', '--cached', '--name-only')).toContain('unrelated.txt');
  });

  it('--commit is a no-op (and never fires) together with --dry-run', async () => {
    initGit(planHome);

    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN, commit: true, dryRun: true });
    expect(result.committed).toBe(false);
    expect(git(planHome, 'status', '--porcelain').trim()).toBe('');
  });
});

describe('migratePanHome: plan home that ignores .pan/ (PAN-3996)', () => {
  const LEGACY_GITIGNORE = 'node_modules/\n# Overdeck state\n.pan/\ndist/\n';

  beforeEach(() => {
    // Isolate from the host's global excludes so only the rules under test apply.
    write(root, 'empty-gitconfig', '');
    vi.stubEnv('GIT_CONFIG_GLOBAL', join(root, 'empty-gitconfig'));
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    initGit(planHome);
    write(planHome, '.gitignore', LEGACY_GITIGNORE);
    write(planHome, 'tracked.txt', 'v1\n');
    git(planHome, 'add', '--', '.gitignore', 'tracked.txt');
    git(planHome, 'commit', '-q', '-m', 'init');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const headFiles = (): string[] =>
    git(planHome, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean).sort();

  it('--commit removes the legacy line and commits .gitignore with the artifacts, and nothing else', async () => {
    write(planHome, 'tracked.txt', 'operator edit, unstaged\n');

    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN, commit: true });

    expect(result.panIgnore).toMatchObject({ kind: 'legacy', line: 3, pattern: '.pan/' });
    expect(result.ignoreLinesRemoved).toEqual([3]);
    expect(result.committed).toBe(true);
    expect(readFileSync(join(planHome, '.gitignore'), 'utf8')).toBe('node_modules/\n# Overdeck state\ndist/\n');
    expect(git(planHome, 'log', '-1', '--format=%s').trim()).toBe(MIGRATION_COMMIT_SUBJECT);
    expect(headFiles()).toEqual(['.gitignore', ...result.copied.map((rel) => `.pan/${rel}`)].sort());
    // The unrelated modification stays exactly where it was: modified, unstaged, uncommitted.
    expect(git(planHome, 'status', '--porcelain')).toBe(' M tracked.txt\n');
    expect(git(planHome, 'diff', '--cached', '--name-only')).toBe('');
  });

  it('--dry-run reports the legacy rule and writes nothing', async () => {
    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN, commit: true, dryRun: true });

    expect(result.panIgnore).toMatchObject({ kind: 'legacy', source: join(planHome, '.gitignore'), line: 3 });
    expect(result.ignoreLinesRemoved).toEqual([]);
    expect(result.committed).toBe(false);
    expect(readFileSync(join(planHome, '.gitignore'), 'utf8')).toBe(LEGACY_GITIGNORE);
    expect(existsSync(join(planHome, '.pan'))).toBe(false);
    expect(git(planHome, 'status', '--porcelain')).toBe('');
  });

  it('without --commit copies, reports the rule, and edits nothing', async () => {
    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });

    expect(result.panIgnore.kind).toBe('legacy');
    expect(result.copied.length).toBeGreaterThan(0);
    expect(result.committed).toBe(false);
    expect(readFileSync(join(planHome, '.gitignore'), 'utf8')).toBe(LEGACY_GITIGNORE);
    // The copies are there but invisible to git: that is what the warning is for.
    expect(git(planHome, 'status', '--porcelain')).toBe('');
  });

  it('a later --commit run commits artifacts an earlier run already copied', async () => {
    await migratePanHome({ stateRoot, planHome, openIssues: OPEN });

    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN, commit: true });

    expect(result.copied).toEqual([]);
    expect(result.committed).toBe(true);
    expect(headFiles()).toContain('.gitignore');
    expect(headFiles()).toContain('.pan/drafts/pan-100.md');
    expect(headFiles()).toContain('.pan/continues/PAN-100.xbrief.json');
    expect(git(planHome, 'status', '--porcelain')).toBe('');
  });

  it('refuses --commit before copying when a foreign rule ignores .pan/, and edits nothing', async () => {
    write(planHome, '.gitignore', 'node_modules/\n');
    git(planHome, 'commit', '-q', '-am', 'drop legacy line');
    write(planHome, '.git/info/exclude', '.pan/\n');

    const failure = await migratePanHome({ stateRoot, planHome, openIssues: OPEN, commit: true }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(MigratePlanHomeError);
    expect((failure as MigratePlanHomeError).code).toBe('pan-ignored-by-foreign-rule');
    expect((failure as Error).message).toContain(`${join(planHome, '.git', 'info', 'exclude')}:1`);
    expect(existsSync(join(planHome, '.pan'))).toBe(false);
    expect(readFileSync(join(planHome, '.git/info/exclude'), 'utf8')).toBe('.pan/\n');
  });

  it('--commit stops without committing when a foreign rule sits behind the legacy line', async () => {
    write(planHome, '.git/info/exclude', '.pan/\n');

    const failure = await migratePanHome({ stateRoot, planHome, openIssues: OPEN, commit: true }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(MigratePlanHomeError);
    expect((failure as MigratePlanHomeError).code).toBe('pan-ignored-by-foreign-rule');
    expect((failure as Error).message).toContain(`${join(planHome, '.git', 'info', 'exclude')}:1`);
    expect(git(planHome, 'log', '-1', '--format=%s').trim()).toBe('init');
    expect(readFileSync(join(planHome, '.git/info/exclude'), 'utf8')).toBe('.pan/\n');
    // The legacy line is gone from the working tree (the message says so); nothing was staged.
    expect(readFileSync(join(planHome, '.gitignore'), 'utf8')).toBe('node_modules/\n# Overdeck state\ndist/\n');
    expect(git(planHome, 'diff', '--cached', '--name-only')).toBe('');
  });

  it('reports a foreign rule without --commit and does not edit it', async () => {
    write(planHome, '.gitignore', 'node_modules/\n');
    git(planHome, 'commit', '-q', '-am', 'drop legacy line');
    write(planHome, '.pan/.gitignore', '*\n');
    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    expect(result.panIgnore).toMatchObject({ kind: 'foreign', source: join(planHome, '.pan', '.gitignore') });
    expect(readFileSync(join(planHome, '.pan/.gitignore'), 'utf8')).toBe('*\n');
  });

  it('refuses --commit when .gitignore already has uncommitted changes', async () => {
    write(planHome, '.gitignore', `${LEGACY_GITIGNORE}operator-rule/\n`);

    const failure = await migratePanHome({ stateRoot, planHome, openIssues: OPEN, commit: true }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(MigratePlanHomeError);
    expect((failure as MigratePlanHomeError).code).toBe('gitignore-dirty');
    expect(existsSync(join(planHome, '.pan'))).toBe(false);
    expect(readFileSync(join(planHome, '.gitignore'), 'utf8')).toBe(`${LEGACY_GITIGNORE}operator-rule/\n`);
  });

  it('a failing git commit surfaces as a typed PlanHomeGitError and leaves nothing staged', async () => {
    write(planHome, '.git/hooks/pre-commit', '#!/bin/sh\necho "hook says no" >&2\nexit 1\n');
    chmodSync(join(planHome, '.git/hooks/pre-commit'), 0o755);

    const failure = await migratePanHome({ stateRoot, planHome, openIssues: OPEN, commit: true }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(PlanHomeGitError);
    expect((failure as PlanHomeGitError).step).toBe('commit');
    expect((failure as Error).message).toContain('hook says no');
    expect(git(planHome, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(planHome, 'log', '-1', '--format=%s').trim()).toBe('init');
  });
});

describe('readOpenIssuesFile', () => {
  it('reads one issue id per line, ignoring blanks and comments', () => {
    const path = join(root, 'open.txt');
    writeFileSync(path, '# open issues\nPAN-100\n\n  PAN-101  \n', 'utf8');
    expect(readOpenIssuesFile(path)).toEqual(['PAN-100', 'PAN-101']);
  });
});
