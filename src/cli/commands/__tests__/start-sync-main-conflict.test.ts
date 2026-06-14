/**
 * PAN-1872 regression test: pan start must continue to spawn the work agent
 * when sync-main reports a merge conflict, instead of crashing with
 * `Cannot read properties of undefined (reading 'toUpperCase')`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const syncMainMock = vi.hoisted(() => vi.fn());
const spawnAgentMock = vi.hoisted(() => vi.fn());
const execSyncMock = vi.hoisted(() => vi.fn());
const execFileSyncMock = vi.hoisted(() => vi.fn());
const resolveProjectFromIssueSyncMock = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/cloister/merge-agent.js', () => ({
  syncMainIntoWorkspace: syncMainMock,
}));

vi.mock('../../../lib/agents.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/agents.js')>('../../../lib/agents.js');
  return {
    ...actual,
    spawnAgent: spawnAgentMock,
    getAgentStateSync: vi.fn(() => null),
    clearAgentPausedSync: vi.fn(),
  };
});

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    exec: vi.fn((_cmd: string, _opts: any, cb?: any) => {
      if (cb) cb(null, { stdout: '', stderr: '' });
      return { stdout: '', stderr: '' } as any;
    }),
    execSync: execSyncMock,
    execFileSync: execFileSyncMock,
  };
});

vi.mock('../../../lib/work-agent-lifecycle.js', () => ({
  assertCanStartFreshSync: vi.fn(() => ({ canStartFresh: true })),
}));

vi.mock('../../../lib/cloister/work-agent-prompt.js', () => ({
  buildWorkAgentPrompt: vi.fn(async () => 'prompt'),
  getTrackerContext: vi.fn(async () => ''),
  readPlanningContext: vi.fn(async () => null),
  readBeadsTasks: vi.fn(async () => []),
}));

vi.mock('../../../lib/config.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/config.js')>()),
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: resolveProjectFromIssueSyncMock,
  findProjectByPathSync: vi.fn(),
  getIssuePrefix: vi.fn(() => 'PAN'),
}));

describe('pan start sync-main conflict (PAN-1872)', () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pan-1872-start-'));
    mkdirSync(join(tmpDir, 'workspaces', 'feature-pan-1872'), { recursive: true });

    syncMainMock.mockReset();
    spawnAgentMock.mockReset();
    execSyncMock.mockReset();
    execFileSyncMock.mockReset();
    resolveProjectFromIssueSyncMock.mockReset();

    resolveProjectFromIssueSyncMock.mockImplementation(() => ({
      projectKey: 'panopticon-cli',
      projectName: 'panopticon-cli',
      projectPath: tmpDir,
      linearTeam: 'PAN',
    }));

    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('git branch --show-current')) return 'feature/pan-1872\n';
      return '';
    });

    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'bd' && args[0] === 'list') {
        return JSON.stringify([{ id: 'bead-1', title: 'Implement issue', status: 'open' }]);
      }
      return '';
    });

    spawnAgentMock.mockResolvedValue({ id: 'agent-pan-1872' });

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code ?? 'undefined'}`);
    }) as never);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    vi.resetModules();
  });

  it('continues to spawn the agent when sync-main reports a conflict', async () => {
    syncMainMock.mockResolvedValue({
      success: false,
      conflictFiles: ['tests/foo.test.ts'],
      reason: 'Sync-main produced 1 conflict(s) in PAN-1872: tests/foo.test.ts. Resolve manually in the workspace, then re-run sync-main.',
    });

    const { issueCommand } = await import('../start.js');

    await issueCommand('PAN-1872', {
      model: 'claude-sonnet-4-6',
      force: true,
    } as any);

    expect(syncMainMock).toHaveBeenCalledWith(expect.any(String), 'PAN-1872');
    expect(spawnAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 'PAN-1872',
        role: 'work',
      }),
    );
  });
});
