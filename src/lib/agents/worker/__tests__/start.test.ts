import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../../agent-state-read.js';
import { workerDir, workerFactsPath } from '../ids.js';
import { reportFooter, startWorker, type SpawnRunForWorker, type StartWorkerDeps } from '../start.js';

let home: string;
let workspace: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.OVERDECK_HOME;
  home = mkdtempSync(join(tmpdir(), 'worker-start-'));
  process.env.OVERDECK_HOME = home;
  workspace = join(home, 'project', 'workspaces', 'feature-pan-9');
  mkdirSync(workspace, { recursive: true });
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

function deps(spawnRun: SpawnRunForWorker, extra: Partial<StartWorkerDeps> = {}): StartWorkerDeps {
  return {
    spawnRun,
    resolveWorkspace: () => workspace,
    createItemWorktree: vi.fn(async (ws: string, item: string) => {
      const path = join(ws, '.swarm', item);
      mkdirSync(path, { recursive: true });
      return path;
    }),
    worktreeBranch: async () => 'feature/pan-9/worker-1',
    now: () => new Date('2026-09-23T12:00:00.000Z'),
    ...extra,
  };
}

const okSpawn = (): ReturnType<typeof vi.fn<SpawnRunForWorker>> =>
  vi.fn<SpawnRunForWorker>(async (_issue, _role, options) => {
    // Every assertion about worker.json ordering reads the disk at this moment.
    expect(existsSync(workerFactsPath(options.agentId))).toBe(false);
    writeFileSync(join(workerDir(options.agentId), 'state.json'), '{}');
    return {} as AgentState;
  });

describe('startWorker (PAN-3920 W13)', () => {
  it('runs a read-only worker in the workspace behind the read-only guard', async () => {
    const spawnRun = okSpawn();
    const started = await startWorker(
      { issueId: 'pan-9', prompt: 'Review the diff.', parentId: 'agent-pan-9-review', readOnly: true },
      deps(spawnRun),
    );

    expect(started).toEqual({ id: 'agent-pan-9-worker-1', cwd: workspace, branch: null, paneReady: true });
    const [issueId, role, options] = spawnRun.mock.calls[0]!;
    expect(issueId).toBe('PAN-9');
    expect(role).toBe('worker');
    expect(options).toMatchObject({
      workspace,
      agentId: 'agent-pan-9-worker-1',
      parentId: 'agent-pan-9-review',
      gitGuardMode: 'read-only',
      startedBy: 'pan-worker',
      registerConversation: false,
      extraEnvExports: ['export OVERDECK_WORKER_PARENT="agent-pan-9-review"'],
    });
  });

  it('creates .swarm/worker-<n> by default and records its branch', async () => {
    const spawnRun = okSpawn();
    const d = deps(spawnRun);
    const started = await startWorker({ issueId: 'PAN-9', prompt: 'Fix it.', parentId: 'conv-7', name: 'fixer' }, d);

    expect(d.createItemWorktree).toHaveBeenCalledWith(workspace, 'worker-1');
    expect(started.cwd).toBe(join(workspace, '.swarm', 'worker-1'));
    expect(started.branch).toBe('feature/pan-9/worker-1');
    expect(spawnRun.mock.calls[0]![2]).toMatchObject({ gitGuardMode: 'default', workspace: started.cwd });
    expect(JSON.parse(readFileSync(workerFactsPath(started.id), 'utf8'))).toEqual({
      id: 'agent-pan-9-worker-1',
      issueId: 'PAN-9',
      parentId: 'conv-7',
      readOnly: false,
      cwd: started.cwd,
      branch: 'feature/pan-9/worker-1',
      name: 'fixer',
      startedAt: '2026-09-23T12:00:00.000Z',
    });
  });

  it('ends the prompt with the report footer', async () => {
    const spawnRun = okSpawn();
    await startWorker({ issueId: 'PAN-9', prompt: 'Do X.', parentId: null }, deps(spawnRun));
    const prompt = spawnRun.mock.calls[0]![2].prompt;
    expect(prompt.startsWith('Do X.')).toBe(true);
    expect(prompt.endsWith(reportFooter('agent-pan-9-worker-1'))).toBe(true);
    expect(prompt).toContain('pan worker report agent-pan-9-worker-1 --file');
    expect(spawnRun.mock.calls[0]![2]).not.toHaveProperty('parentId');
  });

  it('refuses a --cwd outside the issue workspace', async () => {
    const spawnRun = okSpawn();
    await expect(
      startWorker({ issueId: 'PAN-9', prompt: 'x', parentId: null, cwd: home }, deps(spawnRun)),
    ).rejects.toThrow('outside');
    expect(spawnRun).not.toHaveBeenCalled();
    expect(existsSync(workerDir('agent-pan-9-worker-1'))).toBe(false);
  });

  it('accepts a --cwd inside the workspace and skips the worktree', async () => {
    const inside = join(workspace, 'packages', 'core');
    mkdirSync(inside, { recursive: true });
    const spawnRun = okSpawn();
    const d = deps(spawnRun);
    const started = await startWorker({ issueId: 'PAN-9', prompt: 'x', parentId: null, cwd: inside }, d);
    expect(started.cwd).toBe(inside);
    expect(d.createItemWorktree).not.toHaveBeenCalled();
  });

  it('refuses when the issue has no workspace', async () => {
    rmSync(workspace, { recursive: true, force: true });
    await expect(startWorker({ issueId: 'PAN-9', prompt: 'x', parentId: null }, deps(okSpawn()))).rejects.toThrow(
      'Run pan start PAN-9 first',
    );
  });

  it('removes the claimed directory when spawnRun fails before state.json exists', async () => {
    const spawnRun = vi.fn<SpawnRunForWorker>(async () => {
      throw new Error('harness missing');
    });
    await expect(startWorker({ issueId: 'PAN-9', prompt: 'x', parentId: null }, deps(spawnRun))).rejects.toMatchObject({
      message: 'harness missing',
      workerId: 'agent-pan-9-worker-1',
    });
    expect(existsSync(workerDir('agent-pan-9-worker-1'))).toBe(false);
  });

  it('keeps the directory and writes worker.json when spawnRun fails after state.json', async () => {
    const spawnRun = vi.fn<SpawnRunForWorker>(async (_issue, _role, options) => {
      writeFileSync(join(workerDir(options.agentId), 'state.json'), '{}');
      throw new Error('kickoff failed');
    });
    await expect(startWorker({ issueId: 'PAN-9', prompt: 'x', parentId: 'conv-7' }, deps(spawnRun))).rejects.toThrow(
      'kickoff failed',
    );
    expect(existsSync(join(workerDir('agent-pan-9-worker-1'), 'state.json'))).toBe(true);
    expect(JSON.parse(readFileSync(workerFactsPath('agent-pan-9-worker-1'), 'utf8'))).toMatchObject({ parentId: 'conv-7' });
  });

  it('rejects a parent id with shell characters', async () => {
    await expect(
      startWorker({ issueId: 'PAN-9', prompt: 'x', parentId: 'conv-$(rm -rf ~)' }, deps(okSpawn())),
    ).rejects.toThrow('Invalid parent id');
  });
});
