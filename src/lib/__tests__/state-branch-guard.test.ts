import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = resolve('scripts/guard-state-plane-branches.sh');
let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'state-branch-guard-'));
  git('init', '-q');
  git('config', 'user.name', 'Guard Test');
  git('config', 'user.email', 'guard@example.com');
  writeFileSync(join(repo, 'README.md'), 'code\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('state branch guard', () => {
  it('rejects state additions on code branches but permits migration deletions', () => {
    const base = git('rev-parse', 'HEAD');
    mkdirSync(join(repo, '.pan', 'records'), { recursive: true });
    writeFileSync(join(repo, '.pan', 'records', 'x.json'), '{}\n');
    git('add', '.');
    git('commit', '-q', '-m', 'state add');
    expect(() => execFileSync('bash', [script, '--branch', 'main', '--range', `${base}..HEAD`], { cwd: repo })).toThrow();

    const added = git('rev-parse', 'HEAD');
    rmSync(join(repo, '.pan', 'records', 'x.json'));
    git('add', '-u');
    git('commit', '-q', '-m', 'state delete');
    expect(() => execFileSync('bash', [script, '--branch', 'main', '--range', `${added}..HEAD`], { cwd: repo })).not.toThrow();
  });

  it('rejects code on overdeck-state and accepts flat state paths', () => {
    const base = git('rev-parse', 'HEAD');
    mkdirSync(join(repo, 'records'));
    writeFileSync(join(repo, 'records', 'x.json'), '{}\n');
    git('add', '.');
    git('commit', '-q', '-m', 'flat state');
    expect(() => execFileSync('bash', [script, '--branch', 'overdeck-state', '--range', `${base}..HEAD`], { cwd: repo })).not.toThrow();

    const state = git('rev-parse', 'HEAD');
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'x.ts'), 'export {}\n');
    git('add', '.');
    git('commit', '-q', '-m', 'code');
    expect(() => execFileSync('bash', [script, '--branch', 'overdeck-state', '--range', `${state}..HEAD`], { cwd: repo })).toThrow();
  });
});
