import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => {
  // Hoisted requires inline import — synchronously resolved at top.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Effect: EffectHoisted } = require('effect') as typeof import('effect');
  return {
    // PAN-1249: closeOut returns Effect<WorkflowResult>, not Promise.
    closeOut: vi.fn(() => EffectHoisted.succeed({ success: true, steps: [] })),
    execFile: vi.fn(),
    findProjectByTeam: vi.fn(() => null),
    resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'overdeck', projectPath: '/repo' })),
    resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'overdeck', projectPath: '/repo' })),
    createInterface: vi.fn(),
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => 'GITHUB_REPOS=eltmon/overdeck:PAN\n'),
  };
});

vi.mock('child_process', async (importActual) => ({
  ...(await importActual<typeof import('child_process')>()),
  execFile: mocks.execFile,
}));

vi.mock('fs', async (importActual) => ({
  ...(await importActual<typeof import('fs')>()),
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
}));

vi.mock('readline', () => ({
  createInterface: mocks.createInterface,
}));

vi.mock('../../../lib/lifecycle/index.js', () => ({
  closeOut: mocks.closeOut,
}));

vi.mock('../../../lib/projects.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/projects.js')>()),
  findProjectByTeam: mocks.findProjectByTeam,
  findProjectByTeamSync: mocks.findProjectByTeam,
  resolveProjectFromIssue: mocks.resolveProjectFromIssue,
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssue,
}));

import { closeOutCommand } from '../close.js';

function installIssueState(labels: string[], state = 'OPEN') {
  mocks.execFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
    cb!(null, { stdout: JSON.stringify({ state, labels: labels.map(name => ({ name })) }), stderr: '' });
  });
}

function answerConfirmation(answer: string) {
  mocks.createInterface.mockReturnValue({
    question: vi.fn((_prompt: string, cb: (answer: string) => void) => cb(answer)),
    close: vi.fn(),
  });
}

describe('closeOutCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OVERDECK_AGENT_ID', '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // closeOutCommand calls process.exit(0) on success (PAN-1621). Stub it with
    // an explicit throw so the promise rejection remains observable in Vitest.
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit unexpectedly called with "${code}"`);
    }) as never);
    installIssueState([]);
    answerConfirmation('yes');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('warns and asks for confirmation when the issue is not verifying-on-main', async () => {
    await expect(closeOutCommand('PAN-1190', {})).rejects.toThrow('process.exit unexpectedly called with "0"');

    const output = vi.mocked(console.log).mock.calls.map(call => String(call[0])).join('\n');
    expect(output).toContain("Issue should normally be in 'verifying-on-main' before close-out.");
    expect(output).toContain("Warning: current canonical state is 'todo', not 'verifying_on_main'.");
    expect(mocks.createInterface).toHaveBeenCalledOnce();
    expect(mocks.closeOut).toHaveBeenCalledWith({
      issueId: 'PAN-1190',
      projectPath: '/repo',
      github: { owner: 'eltmon', repo: 'overdeck', number: 1190 },
    });
  });

  it('skips the confirmation prompt when --force is used', async () => {
    await expect(closeOutCommand('PAN-1190', { force: true })).rejects.toThrow('process.exit unexpectedly called with "0"');

    expect(mocks.createInterface).not.toHaveBeenCalled();
    expect(mocks.closeOut).toHaveBeenCalledOnce();
  });

  it('allows the flywheel orchestrator to close out', async () => {
    vi.stubEnv('OVERDECK_AGENT_ID', 'flywheel-orchestrator');
    await expect(closeOutCommand('PAN-1190', { force: true })).rejects.toThrow('process.exit unexpectedly called with "0"');

    // Not barred by the caller guard, and the close-out actually runs.
    expect(process.exit).not.toHaveBeenCalledWith(1);
    expect(mocks.closeOut).toHaveBeenCalledOnce();
  });

  it('allows an operator conversation (conv-*) to close out', async () => {
    vi.stubEnv('OVERDECK_AGENT_ID', 'conv-20260608-1234');
    await expect(closeOutCommand('PAN-1190', { force: true })).rejects.toThrow('process.exit unexpectedly called with "0"');

    expect(process.exit).not.toHaveBeenCalledWith(1);
    expect(mocks.closeOut).toHaveBeenCalledOnce();
  });

  it('bars other autonomous agents (agent-*/planning-*/strike-*) from closing out', async () => {
    vi.stubEnv('OVERDECK_AGENT_ID', 'agent-pan-123');
    await expect(closeOutCommand('PAN-1190', { force: true })).rejects.toThrow('process.exit unexpectedly called with "1"');

    expect(process.exit).toHaveBeenCalledWith(1);
    const errors = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join('\n');
    expect(errors).toContain('not permitted');
  });
});
