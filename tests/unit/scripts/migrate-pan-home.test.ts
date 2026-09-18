/**
 * PAN-3917 W1 / D8: the state-worktree → `.pan/` migration copies per-issue
 * artifacts for OPEN issues only, always copies the project-wide ones, and is
 * idempotent.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MIGRATION_COMMIT_SUBJECT,
  destinationName,
  issueIdForArtifact,
  migratePanHome,
  readOpenIssuesFile,
} from '../../../scripts/migrate-pan-home.js';

let root: string;
let stateRoot: string;
let planHome: string;

function write(base: string, rel: string, content: string): void {
  const path = join(base, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'migrate-pan-home-'));
  stateRoot = join(root, 'state');
  planHome = join(root, 'repo');
  mkdirSync(planHome, { recursive: true });

  write(stateRoot, 'drafts/pan-100.md', '# open draft\n');
  write(stateRoot, 'drafts/pan-200.md', '# closed draft\n');
  write(stateRoot, 'specs/2026-01-01-PAN-100-open.xbrief.json', '{"open":true}\n');
  write(stateRoot, 'specs/2026-01-01-PAN-200-closed.xbrief.json', '{"open":false}\n');
  // State-worktree continues carry the legacy lowercase `.vbrief.json` name.
  write(stateRoot, 'continues/pan-100.vbrief.json', '{"issueId":"PAN-100"}\n');
  write(stateRoot, 'continues/pan-200.vbrief.json', '{"issueId":"PAN-200"}\n');
  write(stateRoot, 'orders/index.json', '[]\n');
  write(stateRoot, 'orders/2026-01-01-wave.json', '{"id":"2026-01-01-wave"}\n');
  write(stateRoot, 'notes/retro.md', 'notes\n');
  write(stateRoot, 'backlog/sequence.md', '# Backlog Sequence\n');
  write(stateRoot, 'records/PAN-100.json', '{"leftBehind":true}\n');
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

  it('is idempotent — a second run copies nothing and reports 0 remaining', async () => {
    const first = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    expect(first.copied.length).toBeGreaterThan(0);

    const second = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    expect(second.copied).toEqual([]);
    expect(second.unchanged).toBe(first.copied.length);
    expect(second.remaining).toBe(0);
  });

  it('re-copies a source file that changed after the first run', async () => {
    await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    write(stateRoot, 'drafts/pan-100.md', '# revised\n');

    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    expect(result.copied).toEqual(['drafts/pan-100.md']);
    expect(readFileSync(join(planHome, '.pan/drafts/pan-100.md'), 'utf8')).toBe('# revised\n');
  });

  it('does not commit without --commit', async () => {
    git(planHome, 'init', '-q', '-b', 'main');
    git(planHome, 'config', 'user.email', 'test@overdeck.local');
    git(planHome, 'config', 'user.name', 'Overdeck Test');
    git(planHome, 'config', 'commit.gpgsign', 'false');

    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN });
    expect(result.committed).toBe(false);
    expect(git(planHome, 'status', '--porcelain')).toContain('.pan/');
  });

  it('commits the copied artifacts with the mandated subject when asked', async () => {
    git(planHome, 'init', '-q', '-b', 'main');
    git(planHome, 'config', 'user.email', 'test@overdeck.local');
    git(planHome, 'config', 'user.name', 'Overdeck Test');
    git(planHome, 'config', 'commit.gpgsign', 'false');

    const result = await migratePanHome({ stateRoot, planHome, openIssues: OPEN, commit: true });
    expect(result.committed).toBe(true);
    expect(git(planHome, 'log', '-1', '--format=%s').trim()).toBe(MIGRATION_COMMIT_SUBJECT);
    expect(git(planHome, 'status', '--porcelain').trim()).toBe('');
  });
});

describe('readOpenIssuesFile', () => {
  it('reads one issue id per line, ignoring blanks and comments', () => {
    const path = join(root, 'open.txt');
    writeFileSync(path, '# open issues\nPAN-100\n\n  PAN-101  \n', 'utf8');
    expect(readOpenIssuesFile(path)).toEqual(['PAN-100', 'PAN-101']);
  });
});
