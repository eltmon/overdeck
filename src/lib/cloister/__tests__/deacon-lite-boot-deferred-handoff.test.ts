/**
 * deacon-lite's boot-time deferred-handoff retry (PAN-4210).
 *
 * PAN-4197..4201's guardrail-deferred hand-offs were never retried because
 * (1) `deacon.globally_paused` silences `runDeaconLite()` before
 * `retryDeferredHandoffs` ever runs, and (2) the schedule lives in the
 * pipeline journal, not in memory, so a dashboard/deacon restart must resume
 * it from disk. This drives the real `startDeaconLite()` interval against a
 * seeded journal + planning `state.json` to prove both behave correctly.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  liveAgentInventory: vi.fn(),
  readAutoSpawnOnFinalizeFlagAsync: vi.fn(),
  spawnWorkAgentThroughAgentsEndpoint: vi.fn(),
  isDeaconGloballyPaused: vi.fn(),
  reconcileClosedIssueAgents: vi.fn(),
  checkApiErrorAgents: vi.fn(),
  emitActivityEntry: vi.fn(),
  listAgentStates: vi.fn(),
  notifyPipeline: vi.fn(),
}));

vi.mock('../../workspaces/resolver.js', () => ({ listWorkspaces: mocks.listWorkspaces }));
vi.mock('../../terminal-backends/inventory.js', () => ({ liveAgentInventory: mocks.liveAgentInventory }));
vi.mock('../../planning/auto-spawn-consent.js', () => ({ readAutoSpawnOnFinalizeFlagAsync: mocks.readAutoSpawnOnFinalizeFlagAsync }));
vi.mock('../work-agent-start.js', () => ({ spawnWorkAgentThroughAgentsEndpoint: mocks.spawnWorkAgentThroughAgentsEndpoint }));
vi.mock('../../overdeck/control-settings.js', () => ({ isDeaconGloballyPaused: mocks.isDeaconGloballyPaused }));
vi.mock('../closed-issue-reaper.js', () => ({ reconcileClosedIssueAgents: mocks.reconcileClosedIssueAgents }));
vi.mock('../deacon-api-recovery.js', () => ({ checkApiErrorAgents: mocks.checkApiErrorAgents }));
vi.mock('../../activity-logger.js', () => ({ emitActivityEntry: mocks.emitActivityEntry }));
vi.mock('../../agents.js', () => ({ listAgentStates: mocks.listAgentStates }));
vi.mock('../../pipeline-notifier.js', () => ({ notifyPipeline: mocks.notifyPipeline }));

const { recordHandoffDeferred } = await import('../deferred-handoff.js');
const { readPipelineJournal } = await import('../pipeline-journal.js');
const { startDeaconLite, stopDeaconLite, DEACON_LITE_INTERVAL_MS } = await import('../deacon-lite.js');

const T0 = Date.parse('2026-09-24T10:00:00.000Z');
const MINUTE = 60_000;
const ISSUE = 'PAN-4210';

let overdeckHome: string;
let workspace: string;

function seedPlanningState(startedAt: number): void {
  const planningDir = join(overdeckHome, 'agents', 'planning-pan-4210');
  mkdirSync(planningDir, { recursive: true });
  writeFileSync(join(planningDir, 'state.json'), JSON.stringify({
    id: 'planning-pan-4210',
    issueId: ISSUE,
    workspace,
    role: 'plan',
    model: 'test-model',
    status: 'running',
    startedAt: new Date(startedAt).toISOString(),
  }), 'utf-8');
}

function handoffEntries() {
  return readPipelineJournal(workspace).filter((entry) => entry.type.startsWith('handoff.'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  overdeckHome = mkdtempSync(join(tmpdir(), 'pan-4210-boot-home-'));
  process.env.OVERDECK_HOME = overdeckHome;
  workspace = mkdtempSync(join(tmpdir(), 'pan-4210-boot-ws-'));

  mocks.listWorkspaces.mockReturnValue([{ id: 'ws1', issueId: ISSUE, path: workspace }]);
  mocks.liveAgentInventory.mockResolvedValue({ backend: 'herdr', panes: [] });
  mocks.readAutoSpawnOnFinalizeFlagAsync.mockResolvedValue(true);
  mocks.spawnWorkAgentThroughAgentsEndpoint.mockResolvedValue({ spawned: true, agentId: 'agent-pan-4210' });
  mocks.isDeaconGloballyPaused.mockReturnValue(false);
  mocks.reconcileClosedIssueAgents.mockResolvedValue([]);
  mocks.checkApiErrorAgents.mockResolvedValue([]);
  mocks.listAgentStates.mockReturnValue([]);

  // The planning session that deferred the hand-off started before it
  // deferred; since PAN-3917 its stop projection writes no state.json, so
  // this label reads 'running' forever even though the process exited long
  // ago (concerns.md).
  seedPlanningState(T0 - 50 * MINUTE);
  recordHandoffDeferred({
    workspacePath: workspace,
    issueId: ISSUE,
    error: 'Work agent count is at the configured ceiling (14/10).',
    httpStatus: 409,
    now: T0 - 45 * MINUTE,
  });
});

afterEach(() => {
  stopDeaconLite();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  rmSync(overdeckHome, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
  vi.clearAllMocks();
});

describe('deacon-lite boot: deferred hand-off retry (PAN-4210)', () => {
  it('re-attempts an overdue deferral immediately on boot when not frozen', async () => {
    startDeaconLite();
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.spawnWorkAgentThroughAgentsEndpoint).toHaveBeenCalledTimes(1);
    expect(mocks.spawnWorkAgentThroughAgentsEndpoint.mock.calls[0]?.[0]).toBe(ISSUE);
    expect(handoffEntries().at(-1)).toMatchObject({ type: 'handoff.started', source: 'deacon-lite' });
  });

  it('holds the overdue deferral while the Deacon is frozen, then retries once unfrozen', async () => {
    mocks.isDeaconGloballyPaused.mockReturnValue(true);
    startDeaconLite();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3 * DEACON_LITE_INTERVAL_MS);

    expect(mocks.spawnWorkAgentThroughAgentsEndpoint).not.toHaveBeenCalled();
    expect(handoffEntries()).toHaveLength(1);
    expect(handoffEntries()[0]).toMatchObject({ type: 'handoff.deferred' });

    mocks.isDeaconGloballyPaused.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(DEACON_LITE_INTERVAL_MS);

    expect(mocks.spawnWorkAgentThroughAgentsEndpoint).toHaveBeenCalledTimes(1);
    expect(handoffEntries().at(-1)).toMatchObject({ type: 'handoff.started', source: 'deacon-lite' });
  });
});
