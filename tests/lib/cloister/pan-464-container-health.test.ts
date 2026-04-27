/**
 * Tests for PAN-464: workspace container health monitoring.
 *
 * Covers:
 *   (a) containerRestartBackoffMs — exponential backoff calculation
 *   (b) checkWorkspaceContainerHealth — restart on first crash (no existing record)
 *   (c) checkWorkspaceContainerHealth — backoff enforcement (too soon to retry)
 *   (d) checkWorkspaceContainerHealth — gave-up logic and agent alerting
 *   (e) checkWorkspaceContainerHealth — burst counter reset after 30 min window
 *   (f) checkWorkspaceContainerHealth — skip when agent session is absent
 *   (g) checkWorkspaceContainerHealth — alert agent when restart itself fails
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// vi.hoisted() — must come before vi.mock() calls that reference these fns
// ---------------------------------------------------------------------------

const { testHome, mockExec, mockSendKeysAsync } = vi.hoisted(() => {
  const testHome = `/tmp/pan-464-container-health-${process.pid}-${Math.random().toString(36).slice(2)}`;

  // Create a callback-style mock.
  // We add util.promisify.custom so that promisify(mockExec) returns a function
  // that resolves with { stdout, stderr } matching the real child_process.exec interface.
  const mockExec = vi.fn();

  const customPromisify = vi.fn().mockImplementation((cmd: string, opts?: unknown) => {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      mockExec(cmd, opts, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
  });
  (mockExec as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = customPromisify;

  return {
    testHome,
    mockExec,
    mockSendKeysAsync: vi.fn().mockResolvedValue(undefined),
  };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('child_process', () => ({
  exec: mockExec,
  execFile: vi.fn(),
}));

vi.mock('../../../src/lib/tmux.js', () => ({
  sessionExists: vi.fn().mockReturnValue(true),
  sessionExistsAsync: vi.fn().mockResolvedValue(true),
  sendKeysAsync: mockSendKeysAsync,
  buildTmuxCommandString: vi.fn().mockReturnValue(''),
  capturePaneAsync: vi.fn().mockResolvedValue(''),
  createSessionAsync: vi.fn().mockResolvedValue(undefined),
  killSession: vi.fn(),
  killSessionAsync: vi.fn().mockResolvedValue(undefined),
  listPaneValues: vi.fn().mockReturnValue([]),
  listPaneValuesAsync: vi.fn().mockResolvedValue([]),
  listSessionNamesAsync: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/lib/cloister/specialists.js', () => ({
  getEnabledSpecialists: vi.fn().mockReturnValue([]),
  getTmuxSessionName: vi.fn().mockReturnValue('mock-session'),
  isRunning: vi.fn().mockResolvedValue(false),
  initializeSpecialist: vi.fn(),
  wakeSpecialist: vi.fn(),
  clearSessionId: vi.fn(),
  spawnEphemeralSpecialist: vi.fn(),
  wakeSpecialistWithTask: vi.fn(),
  getAllProjectSpecialistStatuses: vi.fn().mockResolvedValue([]),
}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: vi.fn(() => testHome),
  };
});

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentRuntimeState: vi.fn().mockReturnValue(null),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  listRunningAgents: vi.fn().mockResolvedValue([]),
  getAgentDir: vi.fn().mockReturnValue('/tmp'),
  getAgentState: vi.fn().mockReturnValue(null),
  saveAgentState: vi.fn(),
}));

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn().mockReturnValue(null),
  findProjectByPath: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../src/lib/review-status.js', () => ({
  setReviewStatus: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import {
  containerRestartBackoffMs,
  checkWorkspaceContainerHealth,
  type DeaconState,
} from '../../../src/lib/cloister/deacon.js';
import { sessionExistsAsync } from '../../../src/lib/tmux.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATE_FILE = join(testHome, '.panopticon', 'deacon', 'health-state.json');

const CONTAINER = 'panopticon-feature-pan-464-frontend-1';
const AGENT_ID = 'agent-pan-464';

function writeState(state: Partial<DeaconState>): void {
  mkdirSync(join(testHome, '.panopticon', 'deacon'), { recursive: true });
  const full: DeaconState = {
    specialists: {} as DeaconState['specialists'],
    patrolCycle: 0,
    recentDeaths: [],
    ...state,
  };
  writeFileSync(STATE_FILE, JSON.stringify(full, null, 2), 'utf-8');
}

function readState(): DeaconState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
}

/**
 * Configure mockExec to simulate exec callback behavior.
 * `responses` maps command substrings to { stdout, error } outcomes.
 * Unmatched commands resolve with empty stdout.
 */
function setupExec(responses: Record<string, { stdout?: string; error?: Error }>): void {
  mockExec.mockImplementation((cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    for (const [pattern, result] of Object.entries(responses)) {
      if (cmd.includes(pattern)) {
        if (result.error) {
          cb(result.error, '', result.error.message);
        } else {
          cb(null, result.stdout ?? '', '');
        }
        return;
      }
    }
    cb(null, '', '');
  });
}

// ---------------------------------------------------------------------------
// (a) containerRestartBackoffMs — pure backoff calculation
// ---------------------------------------------------------------------------

describe('containerRestartBackoffMs', () => {
  it('returns 60s for first restart (count=1)', () => {
    expect(containerRestartBackoffMs(1)).toBe(60_000);
  });

  it('doubles for each subsequent attempt', () => {
    expect(containerRestartBackoffMs(2)).toBe(120_000);
    expect(containerRestartBackoffMs(3)).toBe(240_000);
  });

  it('caps at 5 minutes for high counts', () => {
    expect(containerRestartBackoffMs(4)).toBe(300_000);
    expect(containerRestartBackoffMs(10)).toBe(5 * 60_000);
    expect(containerRestartBackoffMs(100)).toBe(5 * 60_000);
  });
});

// ---------------------------------------------------------------------------
// (b–g) checkWorkspaceContainerHealth
// ---------------------------------------------------------------------------

describe('checkWorkspaceContainerHealth', () => {
  let originalState: string | null = null;

  beforeEach(() => {
    vi.clearAllMocks();

    // Back up existing deacon state
    if (existsSync(STATE_FILE)) {
      originalState = readFileSync(STATE_FILE, 'utf-8');
    } else {
      originalState = null;
    }

    // After clearAllMocks, re-apply the promisify.custom symbol
    const customPromisify = vi.fn().mockImplementation((cmd: string, opts?: unknown) => {
      return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        mockExec(cmd, opts, (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      });
    });
    (mockExec as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = customPromisify;

    // Default: container crashed, agent IS running, docker restart succeeds,
    // lsof returns no orphaned PIDs
    setupExec({
      'docker ps -a': { stdout: `${CONTAINER}|Exited (1) 2 minutes ago\n` },
      'tmux has-session': { stdout: '' },      // agent IS running (no error)
      'docker restart': { stdout: '' },
      'lsof': { stdout: '' },
    });
  });

  afterEach(() => {
    if (originalState !== null) {
      writeFileSync(STATE_FILE, originalState, 'utf-8');
    } else if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE);
    }
    rmSync(testHome, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // (b) First crash — restart immediately
  // -------------------------------------------------------------------------

  it('(b) restarts container and saves restart record on first crash', async () => {
    writeState({ containerRestarts: {} });

    const actions = await checkWorkspaceContainerHealth();

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/Auto-restarted.*pan-464-frontend.*attempt 1\/5/);

    const state = readState();
    expect(state.containerRestarts![CONTAINER]).toBeDefined();
    expect(state.containerRestarts![CONTAINER].count).toBe(1);
    expect(state.containerRestarts![CONTAINER].gaveUp).toBeUndefined();
  });

  it('(b) sends informational tmux message to agent on first restart', async () => {
    writeState({ containerRestarts: {} });

    await checkWorkspaceContainerHealth();

    expect(mockSendKeysAsync).toHaveBeenCalledWith(
      AGENT_ID,
      expect.stringContaining('auto-restarted'),
      'deacon:container-restarted',
    );
  });

  // -------------------------------------------------------------------------
  // (c) Within backoff window — skip restart
  // -------------------------------------------------------------------------

  it('(c) skips restart when within 60s backoff window', async () => {
    const recent = new Date(Date.now() - 30_000).toISOString(); // 30s ago, backoff=60s
    writeState({
      containerRestarts: {
        [CONTAINER]: { count: 1, firstRestart: recent, lastRestart: recent },
      },
    });

    const actions = await checkWorkspaceContainerHealth();

    expect(actions).toHaveLength(0);
    // docker restart should NOT have been called
    const restartCalled = (mockExec.mock.calls as Array<[string]>).some(([cmd]) => cmd.includes('docker restart'));
    expect(restartCalled).toBe(false);
  });

  it('(c) allows restart after backoff expires (count=1, 90s elapsed)', async () => {
    const old = new Date(Date.now() - 90_000).toISOString(); // 90s ago, backoff=60s → ok
    writeState({
      containerRestarts: {
        [CONTAINER]: { count: 1, firstRestart: old, lastRestart: old },
      },
    });

    const actions = await checkWorkspaceContainerHealth();

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/attempt 2\/5/);
  });

  // -------------------------------------------------------------------------
  // (d) Max restarts exceeded — gave up
  // -------------------------------------------------------------------------

  it('(d) marks gaveUp and alerts agent after max restarts exceeded', async () => {
    const recent = new Date(Date.now() - 10 * 60_000).toISOString(); // within 30 min window
    const justNow = new Date(Date.now() - 1000).toISOString();
    writeState({
      containerRestarts: {
        [CONTAINER]: { count: 5, firstRestart: recent, lastRestart: justNow },
      },
    });

    const actions = await checkWorkspaceContainerHealth();

    expect(actions.some(a => a.includes('giving up'))).toBe(true);
    const state = readState();
    expect(state.containerRestarts![CONTAINER].gaveUp).toBe(true);

    expect(mockSendKeysAsync).toHaveBeenCalledWith(
      AGENT_ID,
      expect.stringContaining('Manual intervention'),
      'deacon:container-gave-up',
    );
  });

  it('(d) silently skips on subsequent patrols after gaveUp=true', async () => {
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    writeState({
      containerRestarts: {
        [CONTAINER]: { count: 5, firstRestart: recent, lastRestart: recent, gaveUp: true },
      },
    });

    const actions = await checkWorkspaceContainerHealth();

    expect(actions).toHaveLength(0);
    expect(mockSendKeysAsync).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (e) Burst window expired → reset and restart fresh
  // -------------------------------------------------------------------------

  it('(e) resets burst counter when first restart was >30 min ago', async () => {
    const longAgo = new Date(Date.now() - 35 * 60_000).toISOString(); // > 30 min ago
    writeState({
      containerRestarts: {
        [CONTAINER]: { count: 5, firstRestart: longAgo, lastRestart: longAgo, gaveUp: true },
      },
    });

    const actions = await checkWorkspaceContainerHealth();

    // Burst reset → fresh restart as attempt 1
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/attempt 1\/5/);
    const state = readState();
    expect(state.containerRestarts![CONTAINER].count).toBe(1);
    expect(state.containerRestarts![CONTAINER].gaveUp).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // (f) Agent not running → skip restart
  // -------------------------------------------------------------------------

  it('(f) skips restart when agent tmux session does not exist', async () => {
    writeState({ containerRestarts: {} });

    setupExec({
      'docker ps -a': { stdout: `${CONTAINER}|Exited (1) 2 minutes ago\n` },
    });
    vi.mocked(sessionExistsAsync).mockResolvedValueOnce(false);

    const actions = await checkWorkspaceContainerHealth();

    expect(actions).toHaveLength(0);
    expect(mockSendKeysAsync).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (h) Init containers exit 0 by design — never restart, never alert
  // -------------------------------------------------------------------------

  it('(h) ignores init containers entirely (one-shot, exit 0 is normal)', async () => {
    writeState({ containerRestarts: {} });

    setupExec({
      'docker ps -a': { stdout: 'panopticon-feature-pan-596-init-1|Exited (0) 30 seconds ago\n' },
      'tmux has-session': { stdout: '' },
      'docker restart': { stdout: '' },
      'lsof': { stdout: '' },
    });

    const actions = await checkWorkspaceContainerHealth();

    expect(actions).toHaveLength(0);
    expect(mockSendKeysAsync).not.toHaveBeenCalled();
    const restartCalled = (mockExec.mock.calls as Array<[string]>).some(([cmd]) => cmd.includes('docker restart'));
    expect(restartCalled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // (i) Service container exit 0 — clean shutdown, not a crash
  // -------------------------------------------------------------------------

  it('(i) skips service containers that exited cleanly (exit 0)', async () => {
    writeState({ containerRestarts: {} });

    setupExec({
      'docker ps -a': { stdout: `${CONTAINER}|Exited (0) 30 seconds ago\n` },
      'tmux has-session': { stdout: '' },
      'docker restart': { stdout: '' },
      'lsof': { stdout: '' },
    });

    const actions = await checkWorkspaceContainerHealth();

    expect(actions).toHaveLength(0);
    expect(mockSendKeysAsync).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (g) Docker restart fails → alert agent
  // -------------------------------------------------------------------------

  it('(g) alerts agent when docker restart itself fails', async () => {
    writeState({ containerRestarts: {} });

    setupExec({
      'docker ps -a': { stdout: `${CONTAINER}|Exited (1) 2 minutes ago\n` },
      'tmux has-session': { stdout: '' },
      'docker restart': { error: new Error('permission denied') },
      'lsof': { stdout: '' },
    });

    const actions = await checkWorkspaceContainerHealth();

    expect(actions).toHaveLength(0); // no successful restart
    expect(mockSendKeysAsync).toHaveBeenCalledWith(
      AGENT_ID,
      expect.stringContaining('restart failed'),
      'deacon:container-restart-failed',
    );
  });
});
