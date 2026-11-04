/**
 * PAN-4852 WI-10: the SageOx binding store under a temp OVERDECK_HOME, and the
 * default-branch check against a scratch git repo.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sageox-binding-home-'));
  process.env.OVERDECK_HOME = home;
  return { overdeckHome: home };
});

import { invalidateProjectsConfigCache } from '../../projects.js';
import {
  bindingDir,
  defaultBranchTracksSageox,
  readBinding,
  readSageoxLinkState,
  writeBinding,
} from '../binding.js';

const scratch = mkdtempSync(join(tmpdir(), 'sageox-binding-scratch-'));
const FIVE_FILES = ['.gitignore', '.repo_0a1b2c3d-1111-2222-3333-444455556666', 'README.md', 'config.json', 'discovered.jsonl'];

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, env: gitEnv, stdio: 'ignore' });
}

function makeSource(name: string, files: readonly string[]): string {
  const dir = join(scratch, name, '.sageox');
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), `content of ${file}\n`);
  }
  return dir;
}

function makeRepo(name: string, trackSageox: boolean): string {
  const root = join(scratch, name);
  mkdirSync(root, { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, 'README.md'), 'readme\n');
  if (trackSageox) {
    mkdirSync(join(root, '.sageox'));
    writeFileSync(join(root, '.sageox', 'config.json'), '{}\n');
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  return root;
}

function writeProjects(yaml: string): void {
  writeFileSync(join(overdeckHome, 'projects.yaml'), yaml);
  invalidateProjectsConfigCache();
}

beforeEach(() => {
  rmSync(join(overdeckHome, 'packs'), { recursive: true, force: true });
});

afterAll(() => {
  rmSync(overdeckHome, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('bindingDir', () => {
  it('lives under the sageox pack cache', () => {
    expect(bindingDir('app')).toBe(join(overdeckHome, 'packs', 'sageox', 'bindings', 'app'));
  });

  it('refuses keys that could escape the store', () => {
    for (const key of ['..', '.', 'a/b', '', 'a b']) expect(() => bindingDir(key)).toThrow(/invalid project key/);
  });
});

describe('writeBinding / readBinding', () => {
  it('round-trips the files, keeping .repo_<uuid> and .gitignore', async () => {
    const source = makeSource('round-trip', [...FIVE_FILES, 'nested/extra.json']);
    await writeBinding('app', source, [...FIVE_FILES, 'nested/extra.json']);
    const binding = await readBinding('app');
    expect(binding).toEqual({ files: [...FIVE_FILES, 'nested/extra.json'].sort() });
    expect(readFileSync(join(bindingDir('app'), '.repo_0a1b2c3d-1111-2222-3333-444455556666'), 'utf8')).toContain(
      '.repo_0a1b2c3d',
    );
  });

  it('replaces an existing binding and leaves no temp directories', async () => {
    await writeBinding('app', makeSource('first', FIVE_FILES), FIVE_FILES);
    await writeBinding('app', makeSource('second', ['config.json']), ['config.json']);
    expect(await readBinding('app')).toEqual({ files: ['config.json'] });
    expect(readdirSync(dirname(bindingDir('app')))).toEqual(['app']);
  });

  it('returns null when there is no config.json', async () => {
    expect(await readBinding('app')).toBeNull();
  });

  it('refuses a source without config.json', async () => {
    const source = makeSource('no-config', ['README.md', '.gitignore']);
    await expect(writeBinding('app', source, ['README.md', '.gitignore'])).rejects.toThrow(/no config.json/);
    expect(existsSync(bindingDir('app'))).toBe(false);
  });

  it('refuses 51 files', async () => {
    const files = ['config.json', ...Array.from({ length: 50 }, (_, i) => `f${i}.json`)];
    const source = makeSource('too-many', files);
    await expect(writeBinding('app', source, files)).rejects.toThrow(/51 files; the limit is 50/);
    expect(existsSync(bindingDir('app'))).toBe(false);
  });

  it('refuses a file path that escapes .sageox/', async () => {
    const source = makeSource('escape', ['config.json']);
    await expect(writeBinding('app', source, ['config.json', '../outside'])).rejects.toThrow(/invalid SageOx binding file path/);
  });
});

describe('defaultBranchTracksSageox', () => {
  it('is true when main commits .sageox/config.json', async () => {
    expect(await defaultBranchTracksSageox(makeRepo('tracked', true), 'main')).toBe(true);
  });

  it('is false when main does not track it, or the branch is missing', async () => {
    const root = makeRepo('untracked', false);
    expect(await defaultBranchTracksSageox(root, 'main')).toBe(false);
    expect(await defaultBranchTracksSageox(root, 'nope')).toBe(false);
    expect(await defaultBranchTracksSageox(root, '--help')).toBe(false);
  });
});

describe('readSageoxLinkState', () => {
  it('reports committed, held and none', async () => {
    const tracked = makeRepo('state-tracked', true);
    const plain = makeRepo('state-plain', false);
    writeProjects(
      'projects:\n' +
        `  tracked:\n    name: T\n    path: ${tracked}\n` +
        `  flagged:\n    name: F\n    path: ${plain}\n    sageox_binding: committed\n` +
        `  held:\n    name: H\n    path: ${plain}\n` +
        `  none:\n    name: N\n    path: ${plain}\n`,
    );
    await writeBinding('held', makeSource('state-held', ['config.json']), ['config.json']);
    expect(await readSageoxLinkState('tracked')).toBe('committed');
    expect(await readSageoxLinkState('flagged')).toBe('committed');
    expect(await readSageoxLinkState('held')).toBe('held');
    expect(await readSageoxLinkState('none')).toBe('none');
  });
});
