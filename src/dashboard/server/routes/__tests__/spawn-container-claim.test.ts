/**
 * PAN-3849 findings round: the container-wait branch returned before the
 * direct-spawn claim and persisted synthetic `pending-container-start` agent
 * state. The claim is now acquired before orchestration and retained by the
 * background job; container progress lives in the lifecycle log + phase
 * events, never in AgentState.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: mockSpawn };
});

const shared = vi.hoisted(() => ({
  appendAgentLifecycleLog: vi.fn(),
  buildPanStartArgs: vi.fn(),
  emitStartAgentPhase: vi.fn(),
  execAsync: vi.fn(),
  execFileAsync: vi.fn(),
  getIssueDataService: vi.fn(),
  invalidateAgentsCache: vi.fn(),
  updateRegistryForAgentStart: vi.fn(),
}));
vi.mock('../agents/shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agents/shared.js')>();
  return { ...actual, ...shared };
});

const mockSaveAgentStateSync = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/agents.js')>();
  return { ...actual, saveAgentStateSync: mockSaveAgentStateSync };
});

import {
  claimAgentStart,
  handleContainerOrchestration,
  releaseAgentStart,
  resetAgentStartsInFlight,
} from '../agents/spawn-helpers.js';

const ISSUE = 'PAN-700';
const AGENT = 'agent-pan-700';

function readJson(response: { body?: unknown }): Record<string, unknown> {
  const payload = response.body as { body?: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

describe('container orchestration under the no-placeholder claim flow', () => {
  let workspacePath: string;
  let devScript: string;
  let dockerPsCalls = 0;
  const spawnPanCommand = vi.fn();
  const markWorkStartAccepted = vi.fn();
  const updateIssueStatus = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetAgentStartsInFlight();
    dockerPsCalls = 0;
    workspacePath = mkdtempSync(join(tmpdir(), 'pan-container-claim-'));
    devScript = join(workspacePath, 'dev');
    writeFileSync(devScript, '#!/bin/sh\nCOMPOSE_PROJECT_NAME="overdeck-${FEATURE_FOLDER}"\nexit 0\n');
    mockSpawn.mockReturnValue({ unref: vi.fn() });
    // docker is up; containers are NOT ready at the initial check but ARE
    // healthy on the background job's first poll (no 3s sleeps in tests).
    shared.execAsync.mockResolvedValue({ stdout: '' });
    shared.execFileAsync.mockImplementation(async () => {
      dockerPsCalls += 1;
      if (dockerPsCalls === 1) return { stdout: '' };
      return { stdout: 'overdeck-feature-pan-700|Up 5 seconds (healthy)\n' };
    });
    shared.appendAgentLifecycleLog.mockResolvedValue(undefined);
    shared.buildPanStartArgs.mockReturnValue(['start', ISSUE]);
    shared.getIssueDataService.mockReturnValue({ patchIssue: vi.fn() });
    spawnPanCommand.mockResolvedValue('activity-9');
    markWorkStartAccepted.mockResolvedValue(undefined);
    updateIssueStatus.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetAgentStartsInFlight();
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('writes no agent state on the container path and releases the retained claim after the background spawn', async () => {
    // spawn.ts acquires the claim before orchestration; the background job
    // retains it until it spawns or gives up.
    expect(claimAgentStart(AGENT)).toBe(true);

    const response = await Effect.runPromise(handleContainerOrchestration({
      issueId: ISSUE,
      workspacePath,
      devScript,
      agentSessionName: AGENT,
      role: 'work',
      effectiveHarness: 'claude-code',
      startedBy: 'test',
      allowHost: false,
      explicitModel: null,
      spawnGuardrails: {} as never,
      projectPath: workspacePath,
      eventStore: { append: () => Effect.succeed(1) },
      spawnPanCommand,
      markWorkStartAccepted,
      updateIssueStatus,
    }) as Effect.Effect<{ status?: number; body?: unknown }>);

    expect(response.status).toBe(200);
    expect(readJson(response)).toMatchObject({ startingContainers: true, agentId: AGENT });

    // No synthetic state at request time (the retired pending-container-start
    // row), and the claim is still held while the background job works.
    expect(mockSaveAgentStateSync).not.toHaveBeenCalled();
    expect(claimAgentStart(AGENT)).toBe(false);

    // The background job spawns `pan start` once containers are healthy…
    await vi.waitFor(() => expect(spawnPanCommand).toHaveBeenCalledTimes(1));
    // …then records consent + status and releases the claim — wait for the
    // terminal background effect, not just the spawn call.
    await vi.waitFor(() => expect(updateIssueStatus).toHaveBeenCalledTimes(1));
    expect(markWorkStartAccepted).toHaveBeenCalledTimes(1);
    expect(updateIssueStatus).toHaveBeenCalledTimes(1);

    // …writes no error/starting state on that path either, and releases the
    // retained claim so a later spawn may proceed.
    expect(mockSaveAgentStateSync).not.toHaveBeenCalled();
    expect(claimAgentStart(AGENT)).toBe(true);
    releaseAgentStart(AGENT);
  });

  // PAN-4256: the container-wait background job must forward the caller's
  // explicit effort to pan start, the same as the direct spawn path.
  it('forwards an explicit effort to buildPanStartArgs on the container path', async () => {
    expect(claimAgentStart(AGENT)).toBe(true);

    await Effect.runPromise(handleContainerOrchestration({
      issueId: ISSUE,
      workspacePath,
      devScript,
      agentSessionName: AGENT,
      role: 'work',
      effectiveHarness: 'claude-code',
      startedBy: 'test',
      allowHost: false,
      explicitModel: null,
      effort: 'low',
      spawnGuardrails: {} as never,
      projectPath: workspacePath,
      eventStore: { append: () => Effect.succeed(1) },
      spawnPanCommand,
      markWorkStartAccepted,
      updateIssueStatus,
    }) as Effect.Effect<{ status?: number; body?: unknown }>);

    await vi.waitFor(() => expect(shared.buildPanStartArgs).toHaveBeenCalledTimes(1));
    expect(shared.buildPanStartArgs).toHaveBeenCalledWith(expect.objectContaining({ effort: 'low' }));

    await vi.waitFor(() => expect(updateIssueStatus).toHaveBeenCalledTimes(1));
    releaseAgentStart(AGENT);
  });
});

// PAN-5600: the start route resolves the compose project through the canonical
// PAN-3049 resolver, so a project-specific prefix (MYN's `myn-${FEATURE_FOLDER}`)
// reaches the container check instead of being rejected as non-`overdeck-`.
describe('container orchestration compose project name (PAN-5600)', () => {
  let workspacePath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    resetAgentStartsInFlight();
    workspacePath = mkdtempSync(join(tmpdir(), 'pan-container-name-'));
    shared.execAsync.mockResolvedValue({ stdout: '' });
    // Containers already healthy: orchestration returns null and the caller spawns directly.
    shared.execFileAsync.mockResolvedValue({ stdout: 'stack-web-1|Up 5 seconds (healthy)\n' });
    shared.appendAgentLifecycleLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetAgentStartsInFlight();
    rmSync(workspacePath, { recursive: true, force: true });
  });

  function writeDevcontainerDev(content: string): string {
    mkdirSync(join(workspacePath, '.devcontainer'), { recursive: true });
    const devPath = join(workspacePath, '.devcontainer', 'dev');
    writeFileSync(devPath, content);
    return devPath;
  }

  function run(devScript: string) {
    return Effect.runPromise(handleContainerOrchestration({
      issueId: ISSUE,
      workspacePath,
      devScript,
      agentSessionName: AGENT,
      role: 'work',
      effectiveHarness: 'claude-code',
      startedBy: 'test',
      allowHost: false,
      explicitModel: null,
      spawnGuardrails: {} as never,
      projectPath: workspacePath,
      eventStore: { append: () => Effect.succeed(1) },
      spawnPanCommand: vi.fn(),
      markWorkStartAccepted: vi.fn(),
      updateIssueStatus: vi.fn(),
    }) as Effect.Effect<{ status?: number; body?: unknown } | null>);
  }

  function containerCheckFeatureName(): unknown {
    const call = shared.appendAgentLifecycleLog.mock.calls.find(([, event]) => event === 'agent.start_container_check');
    return (call?.[2] as { featureName?: unknown } | undefined)?.featureName;
  }

  it('accepts a project-prefixed name declared as myn-${FEATURE_FOLDER}', async () => {
    const devScript = writeDevcontainerDev('#!/bin/sh\nexport COMPOSE_PROJECT_NAME="myn-${FEATURE_FOLDER}"\n');

    const response = await run(devScript);

    expect(response).toBeNull();
    expect(containerCheckFeatureName()).toBe('myn-feature-pan-700');
    expect(shared.execFileAsync).toHaveBeenCalledWith(
      'docker',
      ['ps', '--filter', 'name=myn-feature-pan-700', '--format', '{{.Names}}|{{.Status}}'],
      expect.anything(),
    );
  });

  it('returns 422 when the declared name does not end in the feature folder', async () => {
    const devScript = writeDevcontainerDev('#!/bin/sh\nexport COMPOSE_PROJECT_NAME="myn-shared-stack"\n');

    const response = await run(devScript);

    expect(response?.status).toBe(422);
    expect(readJson(response!)).toMatchObject({
      success: false,
      blocked: true,
      skipped: true,
      error: expect.stringContaining('expected a name ending in feature-pan-700'),
    });
    expect(containerCheckFeatureName()).toBeUndefined();
    expect(shared.execFileAsync).not.toHaveBeenCalled();
  });

  it('falls back to overdeck-feature-<id> when nothing declares a name and no compose file exists', async () => {
    const devScript = join(workspacePath, 'dev');
    writeFileSync(devScript, '#!/bin/sh\nexit 0\n');

    const response = await run(devScript);

    expect(response).toBeNull();
    expect(containerCheckFeatureName()).toBe('overdeck-feature-pan-700');
  });
});
