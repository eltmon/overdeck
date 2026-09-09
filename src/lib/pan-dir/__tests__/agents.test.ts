import { execFileSync } from 'node:child_process';
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
  useActualAutoCommit: false,
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
  return {
    ...actual,
    queueAutoCommit: (options: Parameters<typeof actual.queueAutoCommit>[0]) => {
      registry.queueAutoCommit(options);
      if (registry.useActualAutoCommit) actual.queueAutoCommit(options);
    },
  };
});

import {
  AgentPlaneOwnershipError,
  appendAgentPlaneLifecycle,
  appendAgentPlaneSession,
  backfillAgentPlaneRecord,
  flushAgentPlaneWrites,
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
    registry.useActualAutoCommit = false;
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

  it('reconciles a tombstone after another writer advances overdeck-state', async () => {
    const remote = join(root, 'origin.git');
    const seed = join(root, 'seed');
    const other = join(root, 'other');
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['init', seed]);
    for (const repo of [seed]) {
      execFileSync('git', ['config', 'user.email', 'test@overdeck.local'], { cwd: repo });
      execFileSync('git', ['config', 'user.name', 'Overdeck Test'], { cwd: repo });
      execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });
    }
    writeFileSync(join(seed, 'migration-complete.json'), markerJson());
    mkdirSync(join(seed, 'agents'), { recursive: true });
    execFileSync('git', ['add', '.'], { cwd: seed });
    execFileSync('git', ['commit', '-m', 'seed state'], { cwd: seed });
    execFileSync('git', ['branch', '-M', 'overdeck-state'], { cwd: seed });
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: seed });
    execFileSync('git', ['push', '-u', 'origin', 'overdeck-state'], { cwd: seed });
    rmSync(stateRoot, { recursive: true, force: true });
    execFileSync('git', ['clone', '--branch', 'overdeck-state', remote, stateRoot]);
    execFileSync('git', ['config', 'user.email', 'test@overdeck.local'], { cwd: stateRoot });
    execFileSync('git', ['config', 'user.name', 'Overdeck Test'], { cwd: stateRoot });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: stateRoot });
    registry.useActualAutoCommit = true;

    const state = agentState(join(projectPath, 'workspaces', 'feature-pan-3513'));
    await recordAgentPlaneSpawn(state, 'session-one');
    await expect(flushAgentPlaneWrites(ISSUE_ID, AGENT_ID)).resolves.toMatchObject({ pushed: true });
    execFileSync('git', ['clone', '--branch', 'overdeck-state', remote, other]);
    execFileSync('git', ['config', 'user.email', 'test@overdeck.local'], { cwd: other });
    execFileSync('git', ['config', 'user.name', 'Overdeck Test'], { cwd: other });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: other });
    await appendAgentPlaneLifecycle(state, {
      at: '2026-08-02T12:00:00.000Z',
      event: 'tombstoned',
    }, { deferCommit: true });

    writeFileSync(join(other, 'concurrent.json'), '{"writer":"other"}\n');
    execFileSync('git', ['add', 'concurrent.json'], { cwd: other });
    execFileSync('git', ['commit', '-m', 'concurrent state write'], { cwd: other });
    execFileSync('git', ['push', 'origin', 'overdeck-state'], { cwd: other });

    await expect(flushAgentPlaneWrites(ISSUE_ID, AGENT_ID)).resolves.toEqual({
      committed: true,
      pushed: true,
    });
    const remoteRecord = JSON.parse(execFileSync(
      'git',
      ['--git-dir', remote, 'show', `overdeck-state:agents/${AGENT_ID}.json`],
      { encoding: 'utf8' },
    ));
    expect(remoteRecord.lifecycle).toContainEqual(expect.objectContaining({ event: 'tombstoned' }));
    expect(execFileSync('git', ['--git-dir', remote, 'show', 'overdeck-state:concurrent.json'], { encoding: 'utf8' }))
      .toContain('other');
  });
});
