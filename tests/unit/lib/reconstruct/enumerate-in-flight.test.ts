import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enumerateInFlightIssuesFromSources } from '../../../../src/lib/reconstruct/enumerate-in-flight.js';
import type { ProjectConfig } from '../../../../src/lib/projects.js';

const project: ProjectConfig = {
  name: 'panopticon',
  path: '/projects/panopticon',
  workspace: { workspaces_dir: 'workspaces' },
};

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

import { readdir } from 'node:fs/promises';
import { exec } from 'node:child_process';

const readdirMock = vi.mocked(readdir);
const execMock = vi.mocked(exec);

function dirent(name: string, isDir = true) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
  } as unknown as import('node:fs').Dirent;
}

beforeEach(() => {
  readdirMock.mockReset();
  execMock.mockReset();
});

describe('enumerateInFlightIssuesFromSources', () => {
  it('returns only open issues that have a feature workspace', async () => {
    readdirMock.mockResolvedValue([
      dirent('feature-pan-1920'),
      dirent('feature-pan-1919'),
      dirent('feature-pan-1000'),
      dirent('not-a-workspace'),
    ]);
    execMock.mockImplementation((_cmd: any, _opts: any, cb: any) => {
      cb?.(new Error('no git'), { stdout: '', stderr: '' });
    });

    const result = await enumerateInFlightIssuesFromSources(
      [project],
      new Set(['PAN-1920', 'PAN-1919']),
    );

    expect([...result].sort()).toEqual(['PAN-1919', 'PAN-1920']);
  });

  it('excludes closed issues that still have a workspace', async () => {
    readdirMock.mockResolvedValue([dirent('feature-pan-1920')]);
    execMock.mockImplementation((_cmd: any, _opts: any, cb: any) => {
      cb?.(new Error('no git'), { stdout: '', stderr: '' });
    });

    const result = await enumerateInFlightIssuesFromSources(
      [project],
      new Set(['PAN-1919']),
    );

    expect([...result]).toEqual([]);
  });

  it('excludes open issues without a workspace', async () => {
    readdirMock.mockResolvedValue([dirent('feature-pan-1920')]);
    execMock.mockImplementation((_cmd: any, _opts: any, cb: any) => {
      cb?.(new Error('no git'), { stdout: '', stderr: '' });
    });

    const result = await enumerateInFlightIssuesFromSources(
      [project],
      new Set(['PAN-1920', 'PAN-9999']),
    );

    expect([...result]).toEqual(['PAN-1920']);
  });

  it('falls back to git worktree list when directory scan fails', async () => {
    readdirMock.mockRejectedValue(new Error('no such directory'));
    execMock.mockImplementation(
      (_cmd: any, _opts: any, cb: any) =>
        cb?.(null, {
          stdout:
            'worktree /projects/panopticon\n' +
            'HEAD abc\n' +
            'branch refs/heads/main\n' +
            'worktree /projects/panopticon/workspaces/feature-pan-1920\n' +
            'HEAD def\n' +
            'branch refs/heads/feature/pan-1920\n',
          stderr: '',
        }) as any,
    );

    const result = await enumerateInFlightIssuesFromSources(
      [project],
      new Set(['PAN-1920']),
    );

    expect([...result]).toEqual(['PAN-1920']);
  });

  it('ignores duplicate feature directories across scan and worktree list', async () => {
    readdirMock.mockResolvedValue([dirent('feature-pan-1920')]);
    execMock.mockImplementation(
      (_cmd: any, _opts: any, cb: any) =>
        cb?.(null, {
          stdout: 'worktree /projects/panopticon/workspaces/feature-pan-1920\n',
          stderr: '',
        }) as any,
    );

    const result = await enumerateInFlightIssuesFromSources(
      [project],
      new Set(['PAN-1920']),
    );

    expect([...result]).toEqual(['PAN-1920']);
  });
});
