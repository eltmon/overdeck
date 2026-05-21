/**
 * Tests for `pan issues --shadow-only` filter behavior.
 *
 * Regression: previously both the full list and the shadow-only subset were
 * rendered together. The --shadow-only flag must suppress the full list and
 * only render the filtered subset.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';

const { loadConfigMock, isShadowedMock, getPendingSyncCountMock, createTrackerMock, loadProjectsConfigMock } =
  vi.hoisted(() => ({
    loadConfigMock: vi.fn(),
    isShadowedMock: vi.fn(),
    getPendingSyncCountMock: vi.fn().mockReturnValue(0),
    createTrackerMock: vi.fn(),
    loadProjectsConfigMock: vi.fn().mockReturnValue({ projects: {} }),
  }));

vi.mock('../../../src/lib/config.js', () => ({
  loadConfig: loadConfigMock,
}));
vi.mock('../../../src/lib/shadow-state.js', () => ({
  isShadowed: isShadowedMock,
  getPendingSyncCount: getPendingSyncCountMock,
}));
vi.mock('../../../src/lib/tracker/index.js', () => ({
  createTracker: createTrackerMock,
}));
vi.mock('../../../src/lib/projects.js', () => ({
  loadProjectsConfig: loadProjectsConfigMock,
}));

import { listCommand } from '../../../src/cli/commands/issues.js';

describe('listCommand --shadow-only', () => {
  let logs: string[];
  let originalLog: typeof console.log;

  beforeEach(() => {
    vi.clearAllMocks();
    logs = [];
    originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };

    loadConfigMock.mockReturnValue({
      trackers: {
        primary: 'github',
        github: { owner: 'eltmon', repo: 'test', token_env: 'GITHUB_TOKEN' },
      },
    });

    const mockIssues = [
      { ref: 'PAN-1', title: 'Open issue', state: 'open', priority: 3 },
      { ref: 'PAN-2', title: 'Shadow issue', state: 'open', priority: 3 },
    ];

    createTrackerMock.mockReturnValue({
      // listIssues is Effect-returning post-PAN-1249.
      listIssues: vi.fn().mockReturnValue(Effect.succeed(mockIssues)),
    });

    // PAN-2 is shadowed, PAN-1 is not
    isShadowedMock.mockImplementation((ref: string) => ref === 'PAN-2');
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it('with --shadow-only: renders ONLY the shadowed subset, not the full list', async () => {
    await listCommand({ shadowOnly: true });

    const output = logs.join('\n');

    // The header for the filtered group should be present
    expect(output).toContain('shadowed issue');
    // The shadowed issue should appear
    expect(output).toContain('PAN-2');
    // The unshadowed issue should NOT appear in the filtered section, but since
    // the full loop is skipped, PAN-1 must not appear at all
    expect(output).not.toContain('PAN-1');
  });

  it('without --shadow-only: renders the full list (no filtering)', async () => {
    await listCommand({});

    const output = logs.join('\n');

    // Both issues appear
    expect(output).toContain('PAN-1');
    expect(output).toContain('PAN-2');
    // No "shadowed issues" header section
    expect(output).not.toContain('shadowed issues');
  });

  it('with --shadow-only and zero shadowed issues: prints "No shadowed issues found"', async () => {
    isShadowedMock.mockReturnValue(false);

    await listCommand({ shadowOnly: true });

    const output = logs.join('\n');
    expect(output).toContain('No shadowed issues found');
    // Full list is still suppressed
    expect(output).not.toContain('PAN-1');
    expect(output).not.toContain('PAN-2');
  });
});
