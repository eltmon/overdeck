import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const childProcessMocks = vi.hoisted(() => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock('child_process', () => childProcessMocks);

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn(() => null),
  hasProjects: vi.fn(() => true),
  listProjects: vi.fn(() => []),
}));

vi.mock('../../../../src/lib/remote/workspace-metadata.js', () => ({
  loadWorkspaceMetadata: vi.fn(() => null),
  findRemoteWorkspaceMetadata: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/config.js', () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  spawnAgent: vi.fn(),
  getProviderAuthMode: vi.fn().mockResolvedValue('oauth'),
}));

describe('pan start post-create validation rollback', () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const spinner = {
    fail: vi.fn(),
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    tmpDir = mkdtempSync(join(tmpdir(), 'pan-start-rollback-'));
    childProcessMocks.execFile.mockImplementation((file: string, args: string[], options: unknown, callback: Function) => {
      callback(null, '', '');
    });
    childProcessMocks.execFileSync.mockImplementation(() => JSON.stringify([{ id: 'workspace-test' }]));

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('destroys a workspace created by this run before exiting for a validation failure', async () => {
    const { __testInternals } = await import('../../../../src/cli/commands/start.js');

    await expect(__testInternals.failPostCreateValidation({
      spinner: spinner as never,
      issueId: 'PAN-1094',
      projectRoot: tmpDir,
      workspaceCreatedThisRun: true,
      message: 'Workspace planning artifacts are for PAN-1093, not PAN-1094',
      printDetails: () => console.log('freshly-created workspace inherited the wrong .pan/spec.vbrief.json'),
    })).rejects.toThrow('process.exit:1');

    expect(spinner.fail).toHaveBeenCalledWith('Workspace planning artifacts are for PAN-1093, not PAN-1094');
    expect(childProcessMocks.execFile).toHaveBeenCalledWith(
      'pan',
      ['workspace', 'destroy', 'PAN-1094', '--force', '--project', tmpDir],
      expect.objectContaining({ cwd: tmpDir }),
      expect.any(Function),
    );
    expect(logSpy.mock.calls.flat().join('\n')).toContain('freshly-created workspace inherited the wrong .pan/spec.vbrief.json');
  });

  it('preserves a pre-existing workspace when validation fails', async () => {
    const { __testInternals } = await import('../../../../src/cli/commands/start.js');

    await expect(__testInternals.failPostCreateValidation({
      spinner: spinner as never,
      issueId: 'PAN-1094',
      projectRoot: tmpDir,
      workspaceCreatedThisRun: false,
      message: 'Workspace planning artifacts are for PAN-1093, not PAN-1094',
      printDetails: () => console.log('workspace is reused or a branch is repurposed'),
    })).rejects.toThrow('process.exit:1');

    expect(childProcessMocks.execFile).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.flat().join('\n')).toContain('workspace is reused or a branch is repurposed');
  });

  it('warns without hiding the validation failure when rollback fails', async () => {
    childProcessMocks.execFile.mockImplementation((file: string, args: string[], options: unknown, callback: Function) => {
      callback(new Error('destroy failed'), '', '');
    });
    const { __testInternals } = await import('../../../../src/cli/commands/start.js');

    await expect(__testInternals.failPostCreateValidation({
      spinner: spinner as never,
      issueId: 'PAN-1094',
      projectRoot: tmpDir,
      workspaceCreatedThisRun: true,
      message: 'No beads tasks found for PAN-1094',
      printDetails: () => {},
    })).rejects.toThrow('process.exit:1');

    expect(warnSpy.mock.calls.flat().join('\n')).toContain('failed to roll back workspace for PAN-1094');
  });
});
