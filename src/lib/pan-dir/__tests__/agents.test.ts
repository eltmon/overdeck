import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../../agents/agent-state.js';
import type { ProjectConfig, ResolvedProject } from '../../projects.js';
import { STATE_BRANCH_PATHS } from '../../state-plane.js';

const registry = vi.hoisted(() => ({
  projects: [] as Array<{ key: string; config: ProjectConfig }>,
  resolved: {} as Record<string, ResolvedProject>,
  configs: {} as Record<string, ProjectConfig>,
  queueAutoCommit: vi.fn(),
}));

vi.mock('../../projects.js', async (importActual) => {
  const actual = await importActual<typeof import('../../projects.js')>();
  return {
    ...actual,
    listProjectsSync: () => registry.projects,
    resolveProjectFromIssueSync: (issueId: string): ResolvedProject | null => registry.resolved[issueId] ?? null,
    getProjectSync: (key: string): ProjectConfig | null => registry.configs[key] ?? null,
  };
});

vi.mock('../auto-commit.js', async (importActual) => {
  const actual = await importActual<typeof import('../auto-commit.js')>();
  return { ...actual, queueAutoCommit: registry.queueAutoCommit };
});

import {
  AgentPlaneOwnershipError,
  appendAgentPlaneLifecycle,
  appendAgentPlaneSession,
  backfillAgentPlaneRecord,
  readAgentPlaneRecordSync,
  recordAgentPlaneSpawn,
} from '../agents.js';

const ISSUE_ID = 'PAN-3513';
const AGENT_ID = 'agent-pan-3513';
const PROJECT_KEY = 'agent-plane-test';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function markerJson(): string {
  return JSON.stringify({
    sourceMainSha: SHA_A,
    stateBranchSha: SHA_B,
    completedAt: '2026-08-02T00:00:00.000Z',
    version: 1,
  });
}

function agentState(workspace: string, startedAt = '2026-08-02T10:00:00.000Z'): AgentState {
  return {
    id: AGENT_ID,
    issueId: ISSUE_ID,
    workspace,
    harness: 'claude-code',
    role: 'work',
    model: 'claude-opus-5',
    status: 'running',
    startedAt,
    branch: 'feature/pan-3513',
  };
}

describe('durable agents plane', () => {
  let root: string;
  let overdeckHome: string;
  let projectPath: string;
  let stateRoot: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-agent-plane-'));
    overdeckHome = join(root, 'overdeck-home');
    projectPath = join(root, 'project');
    stateRoot = join(overdeckHome, 'state', PROJECT_KEY);
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(stateRoot, { recursive: true });
    process.env.OVERDECK_HOME = overdeckHome;

    const config: ProjectConfig = { name: 'Agent Plane Test', path: projectPath };
    registry.projects = [{ key: PROJECT_KEY, config }];
    registry.resolved = {
      [ISSUE_ID]: {
        projectKey: PROJECT_KEY,
        projectName: 'Agent Plane Test',
        projectPath,
      },
    };
    registry.configs = { [PROJECT_KEY]: config };
    registry.queueAutoCommit.mockClear();
    writeFileSync(join(stateRoot, 'migration-complete.json'), markerJson());
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('registers agents/ as canonical overdeck-state content', () => {
    expect(STATE_BRANCH_PATHS).toContain('agents/');
  });

  it('round-trips metadata and preserves append-only session and lifecycle history', async () => {
    const state = agentState(join(projectPath, 'workspaces', 'feature-pan-3513'));
    await expect(recordAgentPlaneSpawn(state, 'session-one')).resolves.toBe(true);
    await expect(appendAgentPlaneSession(state, {
      id: 'session-two',
      startedAt: '2026-08-02T11:00:00.000Z',
      reason: 'rotation',
    })).resolves.toBe(true);
    await expect(appendAgentPlaneSession(state, {
      id: 'session-two',
      startedAt: '2026-08-02T11:01:00.000Z',
      reason: 'rotation',
    })).resolves.toBe(false);
    await expect(appendAgentPlaneLifecycle(state, {
      at: '2026-08-02T12:00:00.000Z',
      event: 'stopped',
    })).resolves.toBe(true);
    await expect(recordAgentPlaneSpawn(
      { ...state, startedAt: '2026-08-02T13:00:00.000Z' },
      'session-three',
    )).resolves.toBe(true);

    const record = readAgentPlaneRecordSync(ISSUE_ID, AGENT_ID);
    expect(record).toMatchObject({
      version: 1,
      agentId: AGENT_ID,
      issueId: ISSUE_ID,
      projectKey: PROJECT_KEY,
      role: 'work',
      origin: { overdeckHome },
      launch: {
        harness: 'claude-code',
        model: 'claude-opus-5',
        branch: 'feature/pan-3513',
      },
      archiveRef: null,
      recovered: false,
    });
    expect(record?.sessions).toEqual([
      { id: 'session-one', startedAt: '2026-08-02T10:00:00.000Z', reason: 'spawn' },
      { id: 'session-two', startedAt: '2026-08-02T11:00:00.000Z', reason: 'rotation' },
      { id: 'session-three', startedAt: '2026-08-02T13:00:00.000Z', reason: 'spawn' },
    ]);
    expect(record?.lifecycle).toEqual([
      { at: '2026-08-02T10:00:00.000Z', event: 'spawned' },
      { at: '2026-08-02T12:00:00.000Z', event: 'stopped' },
      { at: '2026-08-02T13:00:00.000Z', event: 'spawned' },
    ]);
    expect(registry.queueAutoCommit).toHaveBeenCalledTimes(4);
    expect(registry.queueAutoCommit).toHaveBeenLastCalledWith(expect.objectContaining({
      projectRoot: projectPath,
      repoRoot: stateRoot,
      paths: [join(stateRoot, 'agents', `${AGENT_ID}.json`)],
    }));

    const raw = readFileSync(join(stateRoot, 'agents', `${AGENT_ID}.json`), 'utf-8');
    expect(raw).not.toContain('transcript');
  });

  it('backfills missing evidence without replacing stronger existing history', async () => {
    const state = agentState(join(projectPath, 'workspaces', 'feature-pan-3513'));
    await recordAgentPlaneSpawn(state, 'session-one');
    await appendAgentPlaneLifecycle(state, {
      at: '2026-08-02T12:00:00.000Z',
      event: 'stopped',
    });

    await expect(backfillAgentPlaneRecord({
      ...state,
      workspace: '/weaker/reconstructed/workspace',
      model: 'weaker-reconstructed-model',
    }, [
      { id: 'session-one', startedAt: state.startedAt, reason: 'recovered' },
      { id: 'recovered-session', startedAt: '2026-08-02T13:00:00.000Z', reason: 'recovered' },
    ], true)).resolves.toBe(true);

    const record = readAgentPlaneRecordSync(ISSUE_ID, AGENT_ID);
    expect(record?.launch).toMatchObject({
      workspace: state.workspace,
      model: state.model,
    });
    expect(record?.sessions).toEqual([
      { id: 'session-one', startedAt: state.startedAt, reason: 'spawn' },
      { id: 'recovered-session', startedAt: '2026-08-02T13:00:00.000Z', reason: 'recovered' },
    ]);
    expect(record?.lifecycle).toEqual([
      { at: state.startedAt, event: 'spawned' },
      { at: '2026-08-02T12:00:00.000Z', event: 'stopped' },
    ]);
    expect(record?.recovered).toBe(true);
  });

  it('rejects a write from a machine other than the record origin', async () => {
    const state = agentState(join(projectPath, 'workspaces', 'feature-pan-3513'));
    await recordAgentPlaneSpawn(state, 'session-one');
    const path = join(stateRoot, 'agents', `${AGENT_ID}.json`);
    const record = JSON.parse(readFileSync(path, 'utf-8'));
    record.origin.machineId = 'different-machine';
    writeFileSync(path, JSON.stringify(record, null, 2));

    await expect(appendAgentPlaneLifecycle(state, {
      at: '2026-08-02T12:00:00.000Z',
      event: 'stopped',
    })).rejects.toBeInstanceOf(AgentPlaneOwnershipError);
  });

  it('logs and skips writes for an unmigrated project', async () => {
    rmSync(join(stateRoot, 'migration-complete.json'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const state = agentState(join(projectPath, 'workspaces', 'feature-pan-3513'));

    await expect(recordAgentPlaneSpawn(state, 'session-one')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('has not migrated to overdeck-state'));
    expect(existsSync(join(stateRoot, 'agents'))).toBe(false);
    expect(registry.queueAutoCommit).not.toHaveBeenCalled();
  });
});
