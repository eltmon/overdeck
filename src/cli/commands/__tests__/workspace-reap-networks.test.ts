import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PAN-3900: `pan workspace reap` lists orphaned workspace networks on a dry
// run and removes them only under --apply. Docker is fully mocked.

const { execFileMock, findOrphans, removeOrphan } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  findOrphans: vi.fn(),
  removeOrphan: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFile: execFileMock };
});

vi.mock('../../../lib/workspace/orphan-networks.js', () => ({
  findOrphanedWorkspaceNetworks: findOrphans,
  removeOrphanedWorkspaceNetwork: removeOrphan,
}));

vi.mock('../../../lib/paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/paths.js')>()),
  getOverdeckHome: () => '/nonexistent-overdeck-home-pan-3900',
}));

const ORPHAN = {
  name: 'overdeck-feature-pan-3894_devnet',
  composeProject: 'overdeck-feature-pan-3894',
  issueId: 'PAN-3894',
  workspacePath: '/repo/overdeck/workspaces/feature-pan-3894',
};

describe('workspace reap: orphaned networks (PAN-3900)', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    // `docker ps -a --filter name=feature-` finds no stack containers.
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (e: null, r: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: '', stderr: '' });
    });
    findOrphans.mockReset().mockResolvedValue([ORPHAN]);
    removeOrphan.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('lists orphaned networks on a dry run and removes nothing', async () => {
    const { workspaceReapCommand } = await import('../workspace-reap.js');
    await workspaceReapCommand({});

    expect(findOrphans).toHaveBeenCalled();
    expect(removeOrphan).not.toHaveBeenCalled();
    const output = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('overdeck-feature-pan-3894_devnet');
  });

  it('removes orphaned networks under --apply --yes even with no stack candidates', async () => {
    const { workspaceReapCommand } = await import('../workspace-reap.js');
    await workspaceReapCommand({ apply: true, yes: true });

    expect(removeOrphan).toHaveBeenCalledWith(ORPHAN);
  });
});
