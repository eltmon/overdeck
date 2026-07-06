import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';

const mockExecFileImpl = vi.hoisted(() => vi.fn());
const mockExecFile = vi.hoisted(() => {
  const { promisify } = require('node:util') as typeof import('node:util');
  const fn = ((...args: any[]) => (mockExecFileImpl as any)(...args)) as any;
  Object.defineProperty(fn, promisify.custom, {
    value: (...args: any[]) => {
      return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        fn(...args, (err: any, stdout: string, stderr: string) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      });
    },
  });
  return fn;
});
const mockFlushAutoCommits = vi.hoisted(() => vi.fn(() => Effect.void));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: mockExecFile,
  };
});

vi.mock('../../../../lib/pan-dir/auto-commit.js', () => ({
  flushAutoCommits: mockFlushAutoCommits,
}));

// Import after mocks so the promisified execFileAsync inside planning-promotion
// is wired to mockExecFile.
import { commitWorkspaceRecordBeforeAutoSpawn } from '../../../../lib/overdeck/planning-promotion.js';

describe('commitWorkspaceRecordBeforeAutoSpawn', () => {
  let workspacePath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    workspacePath = mkdtempSync(join(tmpdir(), 'record-commit-'));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  function makeRecordModified(issueId: string): void {
    const recordDir = join(workspacePath, '.pan', 'records');
    mkdirSync(recordDir, { recursive: true });
    writeFileSync(join(recordDir, `${issueId.toLowerCase()}.json`), JSON.stringify({ issueId }, null, 2));
  }

  it('stages and commits a modified per-issue record', async () => {
    mkdirSync(join(workspacePath, '.git'), { recursive: true });
    makeRecordModified('PAN-2390');
    mockExecFileImpl.mockImplementation((_file: string, args: string[], _opts: any, callback: any) => {
      const cmd = (args as string[]).join(' ');
      if (cmd.includes('status --porcelain')) {
        callback?.(null, 'M .pan/records/pan-2390.json', '');
      } else if (cmd.includes('diff --cached --quiet')) {
        callback?.(new Error('has changes'), '', '');
      } else if (cmd.includes('git commit')) {
        callback?.(null, '', '');
      } else {
        callback?.(null, '', '');
      }
      return undefined as any;
    });

    await commitWorkspaceRecordBeforeAutoSpawn(workspacePath, 'PAN-2390');

    expect(mockFlushAutoCommits).toHaveBeenCalledWith(workspacePath);
    const calls = mockExecFileImpl.mock.calls.map(c => `${(c[1] as string[]).join(' ')}`);
    expect(calls).toContain('status --porcelain -- .pan/records/pan-2390.json');
    expect(calls).toContain('add -- .pan/records/pan-2390.json');
    expect(calls).toContain('diff --cached --quiet -- .pan/records/pan-2390.json');
    expect(calls.some(c => c.includes('commit') && c.includes('chore(records): update PAN-2390 per-issue record before auto-start'))).toBe(true);
  });

  it('is a no-op when the record is already committed', async () => {
    mkdirSync(join(workspacePath, '.git'), { recursive: true });
    makeRecordModified('PAN-2391');
    mockExecFileImpl.mockImplementation((_file: string, args: string[], _opts: any, callback: any) => {
      const cmd = (args as string[]).join(' ');
      if (cmd.includes('status --porcelain')) {
        callback?.(null, '', '');
      } else {
        callback?.(null, '', '');
      }
      return undefined as any;
    });

    await commitWorkspaceRecordBeforeAutoSpawn(workspacePath, 'PAN-2391');

    const calls = mockExecFileImpl.mock.calls.map(c => `${c[0]} ${(c[1] as string[]).join(' ')}`);
    expect(calls).not.toContain('git add -- .pan/records/pan-2391.json');
    expect(calls).not.toContain(expect.stringContaining('git commit'));
  });

  it('is a no-op when the workspace is not a git repo', async () => {
    makeRecordModified('PAN-2392');

    await expect(commitWorkspaceRecordBeforeAutoSpawn(workspacePath, 'PAN-2392')).resolves.toBeUndefined();

    expect(mockExecFileImpl).not.toHaveBeenCalled();
  });

  it('survives git command failures without throwing', async () => {
    mkdirSync(join(workspacePath, '.git'), { recursive: true });
    makeRecordModified('PAN-2393');
    mockExecFileImpl.mockImplementation((_file: string, _args: string[], _opts: any, callback: any) => {
      callback?.(new Error('git exploded'), '', '');
      return undefined as any;
    });

    await expect(commitWorkspaceRecordBeforeAutoSpawn(workspacePath, 'PAN-2393')).resolves.toBeUndefined();
  });
});
