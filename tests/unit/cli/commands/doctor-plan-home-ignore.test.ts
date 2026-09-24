/**
 * PAN-3996: the `pan doctor` row that flags registered plan homes ignoring
 * `.pan/`. Real temp git repos with the real detector; the project list and
 * plan-home resolution are injected.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PLAN_HOME_IGNORE_ROW, checkPlanHomePanIgnore } from '../../../../src/cli/commands/doctor-plan-home-ignore.js';

let root: string;

function write(base: string, rel: string, content: string): void {
  const path = join(base, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function repo(name: string, gitignore?: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  if (gitignore !== undefined) write(dir, '.gitignore', gitignore);
  return dir;
}

function projects(...entries: Array<[string, string]>) {
  return () => entries.map(([key, path]) => ({ key, config: { path } }));
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'doctor-plan-home-ignore-')));
  write(root, 'empty-gitconfig', '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(root, 'empty-gitconfig'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('checkPlanHomePanIgnore', () => {
  it('is OK when no plan home ignores .pan/, skipping missing and non-git paths', async () => {
    const clean = repo('clean', 'node_modules/\n');
    mkdirSync(join(root, 'not-git'));

    const row = await checkPlanHomePanIgnore({
      projects: projects(['clean', clean], ['plain', join(root, 'not-git')], ['gone', join(root, 'gone')]),
      resolvePlanHome: (path) => path,
    });

    expect(row).toEqual({ name: PLAN_HOME_IGNORE_ROW, status: 'ok', message: '.pan/ is committable in 1 plan home' });
  });

  it('WARNs on the legacy line with its file:line and the repair command, and edits nothing', async () => {
    const tindra = repo('tindra', 'node_modules/\n.pan/\n');

    const row = await checkPlanHomePanIgnore({
      projects: projects(['tindra', tindra]),
      resolvePlanHome: (path) => path,
    });

    expect(row.status).toBe('warn');
    expect(row.message).toContain(`tindra (${join(tindra, '.gitignore')}:2 (.pan/))`);
    // Review of #3998: the repair-only path, not the full migration.
    expect(row.fix).toContain('pan admin migrate-plan-home tindra --repair-ignore');
    expect(row.fix).toContain('commits .gitignore alone');
    expect(row.fix).not.toContain('--commit');
    expect(row.fix).toContain(`${join(tindra, '.gitignore')}:2`);
    expect(readFileSync(join(tindra, '.gitignore'), 'utf8')).toBe('node_modules/\n.pan/\n');
  });

  it('WARNs on a foreign rule without offering the legacy repair', async () => {
    const other = repo('other', '.pan/*\n');

    const row = await checkPlanHomePanIgnore({
      projects: projects(['other', other]),
      resolvePlanHome: (path) => path,
    });

    expect(row.status).toBe('warn');
    expect(row.message).toContain(`${join(other, '.gitignore')}:1 (.pan/*)`);
    expect(row.fix).toContain("is not Overdeck's legacy line");
    expect(row.fix).not.toContain('migrate-plan-home');
  });

  it('checks a shared plan home once and resolves plan homes through the injected resolver', async () => {
    const shared = repo('shared', '.pan\n');
    const row = await checkPlanHomePanIgnore({
      projects: projects(['a', join(root, 'a-checkout')], ['b', join(root, 'b-checkout')]),
      resolvePlanHome: () => shared,
    });

    expect(row.status).toBe('warn');
    expect(row.message).toMatch(/^1 plan home ignore/);
    expect(row.message).toContain('a (');
    expect(row.message).not.toContain('b (');
  });

  it('reports a detector failure as a warning instead of throwing', async () => {
    const clean = repo('clean');
    const row = await checkPlanHomePanIgnore({
      projects: projects(['clean', clean]),
      resolvePlanHome: (path) => path,
      detect: async () => {
        throw new Error('git check-ignore failed');
      },
    });

    expect(row.status).toBe('warn');
    expect(row.message).toContain('clean (could not check: git check-ignore failed)');
  });
});
