/**
 * Unit tests for retro-agent waitForRetroCompletion lifecycle (PAN-709)
 *
 * Covers:
 *  - success path: session exits + new retro file found → success: true
 *  - no-file path: session exits but no new file → success: false
 *  - pre-existing file is not counted as a new write
 *  - timeout path: session never exits → timedOut: true
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks (hoisted before any imports from the module under test)
// ---------------------------------------------------------------------------

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../tmux.js', () => ({
  sessionExistsAsync: vi.fn().mockResolvedValue(false),
  killSessionAsync: vi.fn().mockResolvedValue(undefined),
  buildTmuxCommandString: vi.fn().mockReturnValue('tmux'),
  sendKeysAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../flywheel/retro-inputs.js', () => ({
  gatherRetroInputs: vi.fn().mockResolvedValue({
    stateMd: null,
    vbriefJson: null,
    feedbackFiles: {},
    tmuxTails: {},
    flywheelStateRow: null,
  }),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssue: vi.fn().mockReturnValue({ projectPath: '/tmp/test-retro' }),
}));

vi.mock('child_process', () => ({
  exec: vi.fn((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
    if (typeof cb === 'function') setImmediate(() => cb(null, { stdout: '', stderr: '' }));
  }),
  execFile: vi.fn((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
    if (typeof cb === 'function') setImmediate(() => cb(null, { stdout: '', stderr: '' }));
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { waitForRetroCompletion } from '../retro-agent.js';
import { sessionExistsAsync, killSessionAsync } from '../../tmux.js';
import { readdir } from 'fs/promises';

const mockSessionExists = vi.mocked(sessionExistsAsync);
const mockKillSession = vi.mocked(killSessionAsync);
const mockReaddir = vi.mocked(readdir);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RETRO_DIR = '/tmp/test-retro/docs/flywheel/retros';
const ISSUE_ID = 'PAN-999';
const SESSION_NAME = 'retro-pan-999';
const SHORT_TIMEOUT_MS = 100;

// ---------------------------------------------------------------------------
// Suite: waitForRetroCompletion
// ---------------------------------------------------------------------------

describe('waitForRetroCompletion', () => {
  beforeEach(() => {
    vi.resetAllMocks(); // also resets mockReturnValue/mockResolvedValue implementations
    mockKillSession.mockResolvedValue(undefined);
    // Baseline defaults (overridden per test as needed)
    mockSessionExists.mockResolvedValue(false);
    mockReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
  });

  it('returns success when session exits and a new retro file is found', async () => {
    mockSessionExists.mockResolvedValue(false);
    mockReaddir.mockResolvedValue(['pan-999-1714000000000.md'] as unknown as Awaited<ReturnType<typeof readdir>>);

    const result = await waitForRetroCompletion(
      SESSION_NAME,
      ISSUE_ID,
      SHORT_TIMEOUT_MS,
      RETRO_DIR,
      new Set(), // no pre-existing files
    );

    expect(result.success).toBe(true);
    expect(result.issueId).toBe(ISSUE_ID);
    expect(result.retroFilePath).toBe(`${RETRO_DIR}/pan-999-1714000000000.md`);
    expect(result.timedOut).toBeUndefined();
  });

  it('returns failure when session exits but no retro file was written', async () => {
    mockSessionExists.mockResolvedValue(false);
    mockReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);

    const result = await waitForRetroCompletion(
      SESSION_NAME,
      ISSUE_ID,
      SHORT_TIMEOUT_MS,
      RETRO_DIR,
      new Set(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No retro file written/);
    expect(result.timedOut).toBeUndefined();
  });

  it('does not count pre-existing retro files as a successful write', async () => {
    mockSessionExists.mockResolvedValue(false);
    // Same old file is present — should not count since it's in existingFiles
    mockReaddir.mockResolvedValueOnce(['pan-999-old.md'] as unknown as Awaited<ReturnType<typeof readdir>>);

    const result = await waitForRetroCompletion(
      SESSION_NAME,
      ISSUE_ID,
      SHORT_TIMEOUT_MS,
      RETRO_DIR,
      new Set(['pan-999-old.md']), // pre-existing — should not count
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No retro file written/);
  });

  it('returns timedOut when session never exits', async () => {
    mockSessionExists.mockResolvedValue(true); // always running

    // A negative timeout makes the deadline immediately in the past — the while loop
    // never executes, simulating the hard cap firing without waiting 5 real minutes.
    const result = await waitForRetroCompletion(
      SESSION_NAME,
      ISSUE_ID,
      -1, // already expired
      RETRO_DIR,
      new Set(),
    );

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.error).toMatch(/hard cap/);
    expect(mockKillSession).toHaveBeenCalledWith(SESSION_NAME);
  });
});
