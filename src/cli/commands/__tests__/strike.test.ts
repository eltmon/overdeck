import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

import { strikeCommand, __testInternals } from '../strike.js';

describe('strikeCommand', () => {
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
    expect(prompt).toContain('pan done PAN-1234 --strike');
    // Strike must explicitly not call the normal review-pipeline form.
    expect(prompt).toContain('Do NOT call plain `pan done`');
  });
});
