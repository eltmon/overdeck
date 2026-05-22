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
    resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'panopticon', projectPath: '/repo' })),
    resolveProjectFromIssueSync: vi.fn(() => ({ projectKey: 'panopticon', projectPath: '/repo' })),
    createInterface: vi.fn(),
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => 'GITHUB_REPOS=eltmon/panopticon-cli:PAN\n'),
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
    vi.stubEnv('PANOPTICON_AGENT_ID', '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installIssueState([]);
    answerConfirmation('yes');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('warns and asks for confirmation when the issue is not verifying-on-main', async () => {
    await closeOutCommand('PAN-1190', {});

    const output = vi.mocked(console.log).mock.calls.map(call => String(call[0])).join('\n');
    expect(output).toContain("Issue should normally be in 'verifying-on-main' before close-out.");
    expect(output).toContain("Warning: current canonical state is 'todo', not 'verifying_on_main'.");
    expect(mocks.createInterface).toHaveBeenCalledOnce();
    expect(mocks.closeOut).toHaveBeenCalledWith({
      issueId: 'PAN-1190',
      projectPath: '/repo',
      github: { owner: 'eltmon', repo: 'panopticon-cli', number: 1190 },
    });
  });

  it('skips the confirmation prompt when --force is used', async () => {
    await closeOutCommand('PAN-1190', { force: true });

    expect(mocks.createInterface).not.toHaveBeenCalled();
    expect(mocks.closeOut).toHaveBeenCalledOnce();
  });
});
