import { describe, expect, it } from 'vitest';
import { COMPOSER_COMMAND_MANIFEST } from '@overdeck/contracts';
import { buildComposerHelpOutput, buildComposerHelpResult } from '../help.js';
import { resolvePolicy } from '../policy.js';

describe('buildComposerHelpOutput', () => {
  it('lists composer-runnable commands first with /pan syntax', () => {
    const output = buildComposerHelpOutput();
    const terminalHeaderIndex = output.indexOf('Run in a terminal (type pan <command> in a shell):');
    const startIndex = output.indexOf('/pan start <id>');
    const statusIndex = output.indexOf('/pan status');

    expect(terminalHeaderIndex).toBeGreaterThan(-1);
    expect(startIndex).toBeGreaterThan(-1);
    expect(statusIndex).toBeGreaterThan(-1);
    expect(startIndex).toBeLessThan(terminalHeaderIndex);
    expect(statusIndex).toBeLessThan(terminalHeaderIndex);
  });

  it('groups terminal commands by manifest category', () => {
    const lines = buildComposerHelpOutput().split('\n');
    expect(lines).toContain('Lifecycle');
    expect(lines.some(line => line.startsWith('  pan doctor'))).toBe(true);
    expect(lines.some(line => line.startsWith('  /pan doctor'))).toBe(false);
  });

  it('lists only top-level terminal commands', () => {
    const lines = buildComposerHelpOutput().split('\n');
    expect(lines.some(line => line.startsWith('  pan plan finalize'))).toBe(false);
    expect(lines.some(line => line.startsWith('  pan review request'))).toBe(false);
  });

  it('returns a deterministic captured result', () => {
    const first = buildComposerHelpResult();
    const second = buildComposerHelpResult();
    expect(first).toMatchObject({
      kind: 'captured',
      status: 'completed',
      command: '/pan help',
      truncated: false,
    });
    expect(first).toEqual(second);
    expect(first.output.length).toBeLessThan(65_536);
  });

  it('counts every top-level command once', () => {
    const lines = buildComposerHelpOutput().split('\n');
    const commandLineCount = lines.filter(line => line.startsWith('  pan ') || line.startsWith('  /pan ')).length;

    const composerRunnableCount = COMPOSER_COMMAND_MANIFEST.filter(
      entry => resolvePolicy(entry.path).mode !== 'terminal-only',
    ).length;
    const topLevelTerminalOnlyCount = COMPOSER_COMMAND_MANIFEST.filter(
      entry => entry.path.length === 1 && resolvePolicy(entry.path).mode === 'terminal-only',
    ).length;

    expect(commandLineCount).toBe(composerRunnableCount + topLevelTerminalOnlyCount);
  });
});
