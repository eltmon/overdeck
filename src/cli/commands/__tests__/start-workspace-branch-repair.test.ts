import { describe, expect, it, vi, beforeEach } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execFile: execFileMock,
  };
});

describe('pan start workspace branch repair', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('creates the feature branch for a clean standalone workspace on main', async () => {
    const workspace = '/tmp/overdeck/workspaces/feature-pan-2044';
    execFileMock.mockImplementation((cmd: string, args: string[], opts: any, cb: any) => {
      if (args.join(' ') === 'rev-parse --show-toplevel') {
        cb(null, { stdout: `${workspace}\n`, stderr: '' });
        return;
      }
      if (args.join(' ') === 'status --porcelain') {
        cb(null, { stdout: '', stderr: '' });
        return;
      }
      if (args.join(' ') === 'branch --list feature/pan-2044') {
        cb(null, { stdout: '', stderr: '' });
        return;
      }
      if (args.join(' ') === 'switch -c feature/pan-2044') {
        cb(null, { stdout: '', stderr: '' });
        return;
      }
      cb(new Error(`unexpected command: ${cmd} ${args.join(' ')}`));
    });

    const { __testInternals } = await import('../start.js');

    await expect(__testInternals.repairMainBranchWorkspace(workspace, 'pan-2044')).resolves.toBe('feature/pan-2044');
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['switch', '-c', 'feature/pan-2044'],
      expect.objectContaining({ cwd: workspace }),
      expect.any(Function),
    );
  });

  it('does not repair when the path belongs to the parent repo checkout', async () => {
    execFileMock.mockImplementation((_cmd: string, args: string[], _opts: any, cb: any) => {
      if (args.join(' ') === 'rev-parse --show-toplevel') {
        cb(null, { stdout: '/tmp/overdeck\n', stderr: '' });
        return;
      }
      if (args.join(' ') === 'status --porcelain') {
        cb(null, { stdout: '', stderr: '' });
        return;
      }
      cb(new Error(`unexpected command: ${args.join(' ')}`));
    });

    const { __testInternals } = await import('../start.js');

    await expect(
      __testInternals.repairMainBranchWorkspace('/tmp/overdeck/workspaces/feature-pan-2044', 'pan-2044'),
    ).resolves.toBeNull();
    expect(execFileMock).not.toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['switch']),
      expect.anything(),
      expect.any(Function),
    );
  });
});
