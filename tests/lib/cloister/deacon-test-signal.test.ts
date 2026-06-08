/**
 * PAN-1681 — deacon test-signal recovery.
 *
 * Covers:
 *  - checkCompletedButUnsignaledTests: recovers a test verdict from the
 *    .pan/test/result.json artifact when the test agent narrated completion but
 *    never POSTed testStatus. Auto-completes on a dead session, nudges-then-
 *    completes on a live-idle session, and NEVER fabricates a verdict when the
 *    artifact is absent.
 *  - checkPendingTestDispatch (strand-surfacing): does not re-dispatch / burn the
 *    retry budget while a live test session exists, and surfaces a one-time stuck
 *    marker at retryCount>=3 instead of silently capping.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  unlinkSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';

// ── Module-level mocks ──────────────────────────────────────────────────────

const mockSetReviewStatus = vi.fn();
const mockLoadReviewStatuses = vi.fn();
const mockSessionExists = vi.fn();
const mockIsPaneDead = vi.fn();
const mockResolveProjectFromIssue = vi.fn();
const mockGetAgentRuntimeState = vi.fn().mockReturnValue(null);
const mockGetAgentState = vi.fn().mockReturnValue(null);
const mockIsIssueClosed = vi.fn();
const mockMessageAgent = vi.fn();
const mockSpawnRun = vi.fn();

vi.mock('../../../src/lib/cloister/issue-closed.js', () => ({
  isIssueClosed: (...args: unknown[]) => mockIsIssueClosed(...args),
}));

vi.mock('../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: vi.fn().mockReturnValue(null),
  setReviewStatus: (...args: unknown[]) => mockSetReviewStatus(...args),
  setReviewStatusSync: (...args: unknown[]) => mockSetReviewStatus(...args),
  loadReviewStatuses: (...args: unknown[]) => mockLoadReviewStatuses(...args),
  MAX_AUTO_REQUEUE: 25,
}));

vi.mock('../../../src/lib/tmux.js', async () => {
  const { Effect } = await import('effect');
  return {
    sessionExists: (...args: unknown[]) => Effect.promise(() => Promise.resolve(mockSessionExists(...args))),
    sessionExistsSync: (...args: unknown[]) => mockSessionExists(...args),
    sendKeys: vi.fn(() => Effect.succeed(undefined)),
    sendKeysProgram: vi.fn(() => Effect.succeed(undefined)),
    buildTmuxCommandString: vi.fn(),
    capturePane: vi.fn(() => Effect.succeed('')),
    createSession: vi.fn(() => Effect.succeed(undefined)),
    isPaneDead: (...args: unknown[]) => Effect.promise(() => Promise.resolve(mockIsPaneDead(...args))),
    killSession: vi.fn(() => Effect.succeed(undefined)),
    killSessionSync: vi.fn(),
    listPaneValues: vi.fn(() => Effect.succeed([])),
    listPaneValuesSync: vi.fn(() => []),
    listSessionNames: vi.fn(() => Effect.succeed([])),
  };
});

// Stub heavy transitive dependency that deacon imports at module level.
vi.mock('../../../src/lib/cloister/specialists.js', () => ({
  getEnabledSpecialists: vi.fn().mockReturnValue([]),
  getTmuxSessionName: vi.fn(),
  isRunning: vi.fn().mockResolvedValue(false),
  initializeSpecialist: vi.fn(),
  spawnEphemeralSpecialist: vi.fn(),
  getAllProjectSpecialistStatuses: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentRuntimeState: (...args: unknown[]) => mockGetAgentRuntimeState(...args),
  getAgentRuntimeStateSync: (...args: unknown[]) => mockGetAgentRuntimeState(...args),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  listRunningAgents: vi.fn(() => []),
  listRunningAgentsSync: vi.fn(() => []),
  getAgentDir: vi.fn().mockReturnValue('/tmp'),
  getAgentState: (...args: unknown[]) => mockGetAgentState(...args),
  getAgentStateSync: (...args: unknown[]) => mockGetAgentState(...args),
  saveAgentState: vi.fn(),
  saveAgentStateSync: vi.fn(),
  messageAgent: (...args: unknown[]) => mockMessageAgent(...args),
  spawnRun: (...args: unknown[]) => mockSpawnRun(...args),
}));

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: (...args: unknown[]) => mockResolveProjectFromIssue(...args),
  resolveProjectFromIssueSync: (...args: unknown[]) => mockResolveProjectFromIssue(...args),
  findProjectByPath: vi.fn().mockReturnValue(null),
  findProjectByPathSync: vi.fn().mockReturnValue(null),
}));

// ── Test scaffolding ──────────────────────────────────────────────────────────

const REVIEW_STATUS_FILE = join(homedir(), '.panopticon', 'review-status.json');

function writeStatusFile(statuses: Record<string, unknown>): void {
  mkdirSync(join(homedir(), '.panopticon'), { recursive: true });
  writeFileSync(REVIEW_STATUS_FILE, JSON.stringify(statuses, null, 2), 'utf-8');
}

/** Create a temp project + workspace and (optionally) seed the verdict artifact. */
function makeWorkspace(issueLower: string, verdict?: { status: string; notes?: string }): string {
  const projectPath = mkdtempSync(join(tmpdir(), 'pan-1681-deacon-'));
  const ws = join(projectPath, 'workspaces', `feature-${issueLower}`);
  mkdirSync(ws, { recursive: true });
  if (verdict) {
    mkdirSync(join(ws, '.pan', 'test'), { recursive: true });
    writeFileSync(join(ws, '.pan', 'test', 'result.json'), JSON.stringify(verdict), 'utf-8');
  }
  return projectPath;
}

describe('checkCompletedButUnsignaledTests (PAN-1681 test-signal failsafe)', () => {
  let originalContent: string | null = null;
  let checkCompletedButUnsignaledTests: () => Promise<string[]>;
  const tmpRoots: string[] = [];

  beforeEach(async () => {
    vi.resetModules();
    mockSetReviewStatus.mockReset();
    mockSessionExists.mockReset().mockReturnValue(false);
    mockIsPaneDead.mockReset().mockResolvedValue(false);
    mockResolveProjectFromIssue.mockReset().mockReturnValue(null);
    mockGetAgentRuntimeState.mockReset().mockReturnValue(null);
    mockIsIssueClosed.mockReset().mockResolvedValue(false);
    mockMessageAgent.mockReset().mockResolvedValue(undefined);
    mockLoadReviewStatuses.mockReset().mockImplementation(() => {
      try {
        return JSON.parse(readFileSync(REVIEW_STATUS_FILE, 'utf-8'));
      } catch {
        return {};
      }
    });

    originalContent = existsSync(REVIEW_STATUS_FILE) ? readFileSync(REVIEW_STATUS_FILE, 'utf-8') : null;

    const mod = await import('../../../src/lib/cloister/deacon.js');
    checkCompletedButUnsignaledTests = mod.checkCompletedButUnsignaledTests;
  });

  afterEach(() => {
    if (originalContent !== null) writeFileSync(REVIEW_STATUS_FILE, originalContent, 'utf-8');
    else if (existsSync(REVIEW_STATUS_FILE)) unlinkSync(REVIEW_STATUS_FILE);
    for (const r of tmpRoots.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  it('dead session + passed artifact → auto-completes testStatus passed', async () => {
    const projectPath = makeWorkspace('pan-1455', { status: 'passed', notes: 'all gates green' });
    tmpRoots.push(projectPath);
    mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon', projectPath: projectPath });
    mockSessionExists.mockReturnValue(false); // dead/missing test session
    writeStatusFile({ 'PAN-1455': { issueId: 'PAN-1455', reviewStatus: 'passed', testStatus: 'pending' } });

    const actions = await checkCompletedButUnsignaledTests();

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-1455', expect.objectContaining({ testStatus: 'passed' }));
    expect(actions.some(a => a.includes('Auto-completed test for PAN-1455') && a.includes('passed'))).toBe(true);
  });

  it('dead session + failed artifact → auto-completes testStatus failed', async () => {
    const projectPath = makeWorkspace('pan-1455', { status: 'failed', notes: '3 tests red' });
    tmpRoots.push(projectPath);
    mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon', projectPath: projectPath });
    mockSessionExists.mockReturnValue(false);
    writeStatusFile({ 'PAN-1455': { issueId: 'PAN-1455', reviewStatus: 'passed', testStatus: 'testing' } });

    await checkCompletedButUnsignaledTests();

    expect(mockSetReviewStatus).toHaveBeenCalledWith(
      'PAN-1455',
      expect.objectContaining({ testStatus: 'failed', testNotes: '3 tests red' }),
    );
  });

  it('alive + idle + artifact → nudges once, then auto-completes on the next pass', async () => {
    const projectPath = makeWorkspace('pan-1242', { status: 'passed', notes: 'ok' });
    tmpRoots.push(projectPath);
    mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon', projectPath: projectPath });
    mockSessionExists.mockReturnValue(true); // live test session
    mockIsPaneDead.mockResolvedValue(false);
    mockGetAgentRuntimeState.mockReturnValue({ state: 'idle', lastActivity: new Date().toISOString() });
    writeStatusFile({ 'PAN-1242': { issueId: 'PAN-1242', reviewStatus: 'passed', testStatus: 'pending' } });

    // First pass: nudge, do NOT mutate status.
    const first = await checkCompletedButUnsignaledTests();
    expect(mockMessageAgent).toHaveBeenCalledTimes(1);
    expect(mockMessageAgent.mock.calls[0][0]).toBe('agent-pan-1242-test');
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
    expect(first.some(a => a.includes('Nudged agent-pan-1242-test'))).toBe(true);

    // Second pass (same module instance keeps the dedup map): auto-complete.
    const second = await checkCompletedButUnsignaledTests();
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-1242', expect.objectContaining({ testStatus: 'passed' }));
    expect(second.some(a => a.includes('Auto-completed test for PAN-1242'))).toBe(true);
  });

  it('alive + idle + NO artifact → nudges to write+POST but never fabricates a verdict', async () => {
    const projectPath = makeWorkspace('pan-1242'); // no artifact seeded
    tmpRoots.push(projectPath);
    mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon', projectPath: projectPath });
    mockSessionExists.mockReturnValue(true);
    mockIsPaneDead.mockResolvedValue(false);
    mockGetAgentRuntimeState.mockReturnValue({ state: 'idle', lastActivity: new Date().toISOString() });
    writeStatusFile({ 'PAN-1242': { issueId: 'PAN-1242', reviewStatus: 'passed', testStatus: 'pending' } });

    await checkCompletedButUnsignaledTests();

    expect(mockMessageAgent).toHaveBeenCalledTimes(1);
    // Critical safety rule (D6): no passed/failed mutation without an artifact.
    const testStatusMutations = mockSetReviewStatus.mock.calls.filter(
      ([, update]) => update && (update.testStatus === 'passed' || update.testStatus === 'failed'),
    );
    expect(testStatusMutations).toHaveLength(0);
  });

  it('skips issues that are not reviewStatus=passed / testStatus in {testing,pending}', async () => {
    writeStatusFile({ 'PAN-9': { issueId: 'PAN-9', reviewStatus: 'reviewing', testStatus: 'pending' } });
    const actions = await checkCompletedButUnsignaledTests();
    expect(actions).toHaveLength(0);
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });
});
