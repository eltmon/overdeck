import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';

const harnessMocks = vi.hoisted(() => ({
  resolveHarness: vi.fn(async () => 'codex'),
}));

const configMocks = vi.hoisted(() => ({
  resolveModel: vi.fn(() => 'gpt-5.5'),
  loadConfigSync: vi.fn(() => ({ config: {} })),
}));

const projectMocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(() => ({ projectPath: '/tmp/project' })),
}));

vi.mock('../../../lib/harness-resolve.js', () => ({
  resolveHarness: harnessMocks.resolveHarness,
}));

vi.mock('../../../lib/config-yaml.js', () => ({
  resolveModel: configMocks.resolveModel,
  loadConfigSync: configMocks.loadConfigSync,
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: projectMocks.resolveProjectFromIssueSync,
}));

import { strikeCommand, __testInternals } from '../strike.js';

describe('strikeCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    harnessMocks.resolveHarness.mockClear();
    harnessMocks.resolveHarness.mockResolvedValue('codex');
    configMocks.resolveModel.mockClear();
    configMocks.resolveModel.mockReturnValue('gpt-5.5');
    configMocks.loadConfigSync.mockClear();
    configMocks.loadConfigSync.mockReturnValue({ config: {} });
    projectMocks.resolveProjectFromIssueSync.mockClear();
    projectMocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/tmp/project' });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('exports a function', () => {
    expect(typeof strikeCommand).toBe('function');
  });

  it('parses multiple positional issue IDs through commander', () => {
    const program = new Command();
    let capturedIds: string[] = [];
    let capturedOptions: Record<string, unknown> = {};

    program
      .command('strike <ids...>')
      .option('--model <model>', 'Model override')
      .option('--harness <harness>', 'Harness')
      .option('--effort <level>', 'Effort')
      .option('--dry-run', 'Dry run')
      .action((ids: string[], options: Record<string, unknown>) => {
        capturedIds = ids;
        capturedOptions = options;
      });

    // Mimic `pan strike PAN-1052 PAN-1141 --model claude-sonnet-4-6 --dry-run`
    program.parse(['strike', 'PAN-1052', 'PAN-1141', '--model', 'claude-sonnet-4-6', '--dry-run'], { from: 'user' });

    expect(capturedIds).toEqual(['PAN-1052', 'PAN-1141']);
    expect(capturedOptions.model).toBe('claude-sonnet-4-6');
    expect(capturedOptions.dryRun).toBe(true);
  });

  it('buildStrikePrompt includes the issue id, branch, and workspace', () => {
    const fakePlan = {
      issueId: 'PAN-1234',
      workspace: '/tmp/feature-pan-1234-strike',
      branch: 'strike/pan-1234',
      sessionName: 'strike-pan-1234',
      projectRoot: '/tmp/project',
    };
    const prompt = __testInternals.buildStrikePrompt(fakePlan);
    expect(prompt).toContain('PAN-1234');
    expect(prompt).toContain('strike/pan-1234');
    expect(prompt).toContain('/tmp/feature-pan-1234-strike');
    expect(prompt).toContain('merge fast-forward to `main`');
    // Strike must explicitly not call pan done
    expect(prompt).toContain('Do NOT call `pan done`');
  });

  it('prints the resolved dry-run harness and model', async () => {
    await strikeCommand(['PAN-1826'], { dryRun: true });

    const output = logSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(output).toContain('Harness:    codex');
    expect(output).toContain('Model:      gpt-5.5');
    expect(harnessMocks.resolveHarness).toHaveBeenCalledWith({
      explicit: undefined,
      role: 'strike',
      model: 'gpt-5.5',
    });
    expect(configMocks.resolveModel).toHaveBeenCalledWith('strike', undefined, {});
  });
});
