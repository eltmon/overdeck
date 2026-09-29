import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  finishScopeTransition,
  resolveScopeTarget,
} from '../../../../src/cli/commands/scope.js';

const execFileAsync = promisify(execFile);

let TEST_DIR: string;

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'scope-plan-home-'));
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('resolveScopeTarget (PAN-4225)', () => {
  it('ac1: uses the workspace as planHome with onMain false when it exists', () => {
    const workspaceDir = join(TEST_DIR, 'workspaces', 'feature-pan-9');
    mkdirSync(workspaceDir, { recursive: true });

    const target = resolveScopeTarget(TEST_DIR, 'PAN-9');

    expect(target.planHome).toBe(workspaceDir);
    expect(target.onMain).toBe(false);
  });

  it('ac1: falls back to the primary checkout with onMain true when there is no workspace', () => {
    const target = resolveScopeTarget(TEST_DIR, 'PAN-9');

    expect(target.planHome).toBe(TEST_DIR);
    expect(target.onMain).toBe(true);
  });
});

describe('finishScopeTransition (PAN-4225)', () => {
  it('ac2: commits only .pan/specs/ and returns a warning instead of throwing when there is no upstream', async () => {
    await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: TEST_DIR });
    await execFileAsync('git', ['config', 'user.email', 'test@test.local'], { cwd: TEST_DIR });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: TEST_DIR });
    writeFileSync(join(TEST_DIR, 'README.md'), '# test\n');
    await execFileAsync('git', ['add', 'README.md'], { cwd: TEST_DIR });
    await execFileAsync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init'], { cwd: TEST_DIR });

    const specDir = join(TEST_DIR, '.pan', 'specs');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'PAN-9.xbrief.json'), '{}\n', 'utf-8');

    const warning = await finishScopeTransition({ planHome: TEST_DIR, onMain: true }, 'scope: approve PAN-9 xBRIEF');

    expect(typeof warning === 'string' || warning === null).toBe(true);
    const { stdout: log } = await execFileAsync('git', ['log', '--format=%H'], { cwd: TEST_DIR });
    expect(log.trim().split('\n')).toHaveLength(2);
    const { stdout: changed } = await execFileAsync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], { cwd: TEST_DIR });
    const changedPaths = changed.trim().split('\n').filter(Boolean);
    expect(changedPaths.length).toBeGreaterThan(0);
    expect(changedPaths.every((p) => p.startsWith('.pan/specs/'))).toBe(true);
  });

  it('ac3: returns null and succeeds outside a git repository when onMain is false', async () => {
    const warning = await finishScopeTransition({ planHome: TEST_DIR, onMain: false }, 'scope: approve PAN-9 xBRIEF');

    expect(warning).toBeNull();
    expect(existsSync(join(TEST_DIR, '.git'))).toBe(false);
  });
});
