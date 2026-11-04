/**
 * PAN-4820 WI-12: `save` writes the Deft state archive into
 * `.pan/deft/<ISSUE>/`, and the archive is current only while it matches the
 * live Deft state byte for byte.
 *
 * A real scratch repo and an isolated global git config. No install is
 * needed: the Deft state files are written directly.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isDeftArchiveCurrent, planDeftArchive, saveDeftState } from '../archive.js';

let scratch: string;
let repo: string;
const savedEnv = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function write(path: string, content: string): void {
  mkdirSync(join(repo, path, '..'), { recursive: true });
  writeFileSync(join(repo, path), content);
}

const head = (): string => git('rev-parse', 'HEAD').trim();

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'deft-archive-'));
  const globalConfig = join(scratch, 'gitconfig');
  writeFileSync(globalConfig, '[user]\n\tname = Overdeck Test\n\temail = test@overdeck.local\n[commit]\n\tgpgsign = false\n');
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(scratch, { recursive: true, force: true });
});

beforeEach(() => {
  repo = mkdtempSync(join(scratch, 'repo-'));
  git('init', '-q', '-b', 'main');
  write('README.md', 'seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
  write('xbrief/PROJECT-DEFINITION.xbrief.json', '{}\n');
  write('xbrief/active/a.xbrief.json', '{"scope":"a"}\n');
  write('xbrief/completed/b.xbrief.json', '{"scope":"b"}\n');
  write('xbrief/decisions/d1.decision.json', '{"decision":"x"}\n');
  write('.deft/approved-scope/plan-a.json', '{"planId":"a"}\n');
  write('.deft/escalations/esc-20261102120000-abcdef.json', '{"status":"open"}\n');
});

describe('planDeftArchive', () => {
  it('maps scopes, decisions, approved scopes and escalations under .pan/deft/<ISSUE>/', async () => {
    const plan = await planDeftArchive(repo, 'tst-1');

    expect(plan.map(entry => entry.archivePath)).toEqual([
      '.pan/deft/TST-1/scopes/active/a.xbrief.json',
      '.pan/deft/TST-1/scopes/completed/b.xbrief.json',
      '.pan/deft/TST-1/decisions/d1.decision.json',
      '.pan/deft/TST-1/approved-scope/plan-a.json',
      '.pan/deft/TST-1/escalations/esc-20261102120000-abcdef.json',
    ]);
    for (const entry of plan) {
      expect(entry.archivePath.startsWith('xbrief/')).toBe(false);
      expect(entry.archivePath.startsWith('.deft/')).toBe(false);
    }
  });

  it('plans nothing for a native Directive project (deposit tracked on the default branch)', async () => {
    write('.deft/core/VERSION', '0.127.0\n');
    git('add', '.deft/core/VERSION');
    git('commit', '-q', '-m', 'deposit');

    expect(await planDeftArchive(repo, 'TST-1')).toEqual([]);
    expect(await isDeftArchiveCurrent(repo, 'TST-1', head())).toBe(true);
  });

  it('does not treat markers that exist only in the worktree as native', async () => {
    write('.deft/core/VERSION', '0.127.0\n');
    write('AGENTS.md', '<!-- deft:managed-section v3 -->\n');

    expect(await planDeftArchive(repo, 'TST-1')).toHaveLength(5);
    expect(await isDeftArchiveCurrent(repo, 'TST-1', head())).toBe(false);
  });
});

describe('saveDeftState and isDeftArchiveCurrent', () => {
  it('commits the archive, and the new HEAD is current', async () => {
    expect(await isDeftArchiveCurrent(repo, 'TST-1', head())).toBe(false);

    const result = await saveDeftState(repo, 'TST-1');

    expect(result).toMatchObject({ committed: true, files: 5 });
    expect(result.sha).toBe(head());
    expect(git('log', '-1', '--format=%s')).toBe('chore(deft): save Deft state for TST-1\n');
    expect(git('show', '--name-only', '--format=', 'HEAD').trim().split('\n')).toHaveLength(5);
    expect(await isDeftArchiveCurrent(repo, 'TST-1', head())).toBe(true);
  });

  it('is not current after a scope file changes', async () => {
    await saveDeftState(repo, 'TST-1');
    const sha = head();

    write('xbrief/active/a.xbrief.json', '{"scope":"a","changed":true}\n');

    expect(await isDeftArchiveCurrent(repo, 'TST-1', sha)).toBe(false);
  });

  it('is not current after a scope file is added or removed', async () => {
    await saveDeftState(repo, 'TST-1');
    const sha = head();

    write('xbrief/pending/c.xbrief.json', '{}\n');
    expect(await isDeftArchiveCurrent(repo, 'TST-1', sha)).toBe(false);

    rmSync(join(repo, 'xbrief', 'pending'), { recursive: true });
    rmSync(join(repo, 'xbrief', 'completed', 'b.xbrief.json'));
    expect(await isDeftArchiveCurrent(repo, 'TST-1', sha)).toBe(false);
  });

  it('commits nothing when the archive is unchanged, and removes deleted state', async () => {
    await saveDeftState(repo, 'TST-1');
    expect(await saveDeftState(repo, 'TST-1')).toEqual({ committed: false, files: 5 });

    rmSync(join(repo, 'xbrief', 'completed', 'b.xbrief.json'));
    const result = await saveDeftState(repo, 'TST-1');

    expect(result).toMatchObject({ committed: true, files: 4 });
    expect(git('show', '--name-status', '--format=', 'HEAD')).toContain('D\t.pan/deft/TST-1/scopes/completed/b.xbrief.json');
    expect(await isDeftArchiveCurrent(repo, 'TST-1', head())).toBe(true);
  });

  it('leaves other staged work out of the save commit', async () => {
    write('other.txt', 'mine\n');
    git('add', 'other.txt');

    await saveDeftState(repo, 'TST-1');

    expect(git('show', '--name-only', '--format=', 'HEAD')).not.toContain('other.txt');
    expect(git('diff', '--cached', '--name-only')).toBe('other.txt\n');
  });

  it('treats an empty plan with no archive as current', async () => {
    rmSync(join(repo, 'xbrief'), { recursive: true });
    rmSync(join(repo, '.deft'), { recursive: true });

    expect(await saveDeftState(repo, 'TST-1')).toEqual({ committed: false, files: 0 });
    expect(await isDeftArchiveCurrent(repo, 'TST-1', head())).toBe(true);
  });

  it('reads an unknown head as not current', async () => {
    expect(await isDeftArchiveCurrent(repo, 'TST-1', 'f'.repeat(40))).toBe(false);
  });
});
