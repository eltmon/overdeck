import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../../agents/agent-state-read.js';
import { workerDir } from '../../agents/worker/ids.js';
import type { WorkerListing } from '../../agents/worker/list.js';
import { startWorker, type SpawnRunForWorker } from '../../agents/worker/start.js';
import type { WaitOutcome } from '../../agents/worker/wait.js';
import { planDigest } from '../../xbrief/plan-digest.js';
import { buildPlanCriticBrief, dispatchPlanCritic, type DispatchDeps, type DispatchPlanCriticInput } from '../plan-critic-dispatch.js';

const ROLE_TEXT = '# Plan critic\n\nDo not read `.overdeck/` (including `.overdeck/continue.json`).\n';
const DOC = { xBRIEFInfo: { version: '0.8' }, plan: { id: 'PAN-9', title: 'Critic fixture plan', status: 'draft', items: [] } };
const CRITIQUE_BODY = '## blocks-the-design: Missing rollback\n\nEvidence.\n';

let home: string;
let workspace: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.OVERDECK_HOME;
  home = mkdtempSync(join(tmpdir(), 'plan-critic-dispatch-'));
  process.env.OVERDECK_HOME = home;
  workspace = join(home, 'project', 'workspaces', 'feature-pan-9');
  mkdirSync(join(workspace, '.pan', 'drafts'), { recursive: true });
  writeFileSync(join(workspace, '.pan', 'drafts', 'PAN-9.md'), '# PRD\n');
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

function input(overrides: Partial<DispatchPlanCriticInput> = {}): DispatchPlanCriticInput {
  return {
    issueId: 'PAN-9',
    workspacePath: workspace,
    prdPath: join(workspace, '.pan', 'drafts', 'PAN-9.md'),
    doc: DOC,
    round: 1,
    parentId: 'planning-pan-9',
    critic: { ok: true, model: 'gpt-5.6-sol', harness: 'codex', family: 'gpt', plannerFamily: 'claude' },
    ...overrides,
  };
}

const spawnSpy = () =>
  vi.fn<SpawnRunForWorker>(async (_issue, _role, options) => {
    writeFileSync(join(workerDir(options.agentId), 'state.json'), '{}');
    return {} as AgentState;
  });

function report(status: 'done' | 'blocked' | 'failed', body = CRITIQUE_BODY): WaitOutcome {
  return { kind: 'report', report: { seq: 1, at: '2026-09-29T00:00:00.000Z', status, body } };
}

function facts(id: string): WorkerListing['facts'] {
  return { id, issueId: 'PAN-9', parentId: 'planning-pan-9', readOnly: true, cwd: workspace, branch: null, name: 'plan-critic-r1', startedAt: '2026-09-29T00:00:00.000Z' };
}

function deps(overrides: Partial<DispatchDeps> = {}): DispatchDeps & { spawnRun: ReturnType<typeof spawnSpy> } {
  const spawnRun = spawnSpy();
  return {
    spawnRun,
    startWorker: vi.fn(startWorker),
    startWorkerDeps: { spawnRun, effortConfig: { roles: {}, tieredExecution: { tiers: {} } } },
    listWorkers: vi.fn(async () => []),
    isAlive: vi.fn(async () => ({ alive: false as const, reason: 'no-session' as const })),
    getAgentState: vi.fn(() => ({ harness: 'codex', model: 'gpt-5.6-sol' }) as AgentState),
    waitForWorkerReport: vi.fn(async () => report('done')),
    stopWorker: vi.fn(async () => {}),
    readRoleText: async () => ROLE_TEXT,
    ...overrides,
  };
}

describe('dispatchPlanCritic', () => {
  it('launches a claude-code planner\'s critic on codex behind the read-only guard', async () => {
    const d = deps();
    const result = await dispatchPlanCritic(input(), d);

    expect(result.kind).toBe('written');
    const [, role, options] = d.spawnRun.mock.calls[0]!;
    expect(role).toBe('worker');
    expect(options).toMatchObject({
      harness: 'codex',
      model: 'gpt-5.6-sol',
      gitGuardMode: 'read-only',
      workspace,
      parentId: 'planning-pan-9',
    });
    expect(options.harness).not.toBe('claude-code');
  });

  it('writes the critique with the plan digest on line 1 and stops the worker', async () => {
    const d = deps();
    const result = await dispatchPlanCritic(input(), d);

    expect(result).toMatchObject({ kind: 'written', path: join(workspace, '.pan', 'drafts', 'PAN-9-critique.md') });
    const text = readFileSync(join(workspace, '.pan', 'drafts', 'PAN-9-critique.md'), 'utf-8');
    expect(text.split('\n')[0]).toBe(`plan-digest: ${planDigest(DOC)}`);
    expect(text).toContain(CRITIQUE_BODY.trim());
    expect(d.stopWorker).toHaveBeenCalledWith('agent-pan-9-worker-1');
  });

  it('refuses and stops a critic that launched on the planner\'s harness', async () => {
    const d = deps({ getAgentState: vi.fn(() => ({ harness: 'claude-code', model: 'claude-opus-4-8' }) as AgentState) });
    const result = await dispatchPlanCritic(input(), d);

    expect(result).toMatchObject({ kind: 'failed', workerId: 'agent-pan-9-worker-1' });
    if (result.kind === 'failed') expect(result.message).toContain('expected codex/gpt-5.6-sol');
    expect(d.stopWorker).toHaveBeenCalledWith('agent-pan-9-worker-1');
    expect(d.waitForWorkerReport).not.toHaveBeenCalled();
  });

  it('waits on a live critic of the same round instead of starting another', async () => {
    const live: WorkerListing = {
      id: 'agent-pan-9-worker-3',
      facts: facts('agent-pan-9-worker-3'),
      latestReport: null,
    };
    const d = deps({
      listWorkers: vi.fn(async () => [live]),
      isAlive: vi.fn(async () => ({ alive: true as const, paneAlive: true as const })),
    });
    const result = await dispatchPlanCritic(input(), d);

    expect(d.startWorker).not.toHaveBeenCalled();
    expect(d.waitForWorkerReport).toHaveBeenCalledWith('agent-pan-9-worker-3', expect.objectContaining({ afterSeq: 0 }));
    expect(result).toMatchObject({ kind: 'written', workerId: 'agent-pan-9-worker-3' });
  });

  it('reuses a finished critic\'s done report without waiting', async () => {
    const finished: WorkerListing = {
      id: 'agent-pan-9-worker-2',
      facts: facts('agent-pan-9-worker-2'),
      latestReport: { seq: 1, at: '2026-09-29T00:00:00.000Z', status: 'done', body: CRITIQUE_BODY },
    };
    const d = deps({ listWorkers: vi.fn(async () => [finished]) });
    const result = await dispatchPlanCritic(input(), d);

    expect(d.startWorker).not.toHaveBeenCalled();
    expect(d.waitForWorkerReport).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: 'written', workerId: 'agent-pan-9-worker-2' });
  });

  it('returns running and leaves the critic up on a wait timeout', async () => {
    const d = deps({ waitForWorkerReport: vi.fn(async () => ({ kind: 'timeout' as const })) });
    const result = await dispatchPlanCritic(input(), d);

    expect(result).toMatchObject({ kind: 'running', workerId: 'agent-pan-9-worker-1' });
    expect(d.stopWorker).not.toHaveBeenCalled();
  });

  it('fails and stops the critic when it reports blocked', async () => {
    const d = deps({ waitForWorkerReport: vi.fn(async () => report('blocked', 'Need a decision.')) });
    const result = await dispatchPlanCritic(input(), d);

    expect(result).toMatchObject({ kind: 'failed' });
    if (result.kind === 'failed') expect(result.message).toContain('Need a decision.');
    expect(d.stopWorker).toHaveBeenCalled();
  });
});

describe('buildPlanCriticBrief', () => {
  it('inlines the draft and the PRD path and nothing from the planner session', () => {
    const draftJson = JSON.stringify(DOC, null, 2);
    const brief = buildPlanCriticBrief({ roleText: ROLE_TEXT, issueId: 'PAN-9', round: 2, prdRelPath: '.pan/drafts/PAN-9.md', draftJson });

    expect(brief).toContain(draftJson);
    expect(brief).toContain('.pan/drafts/PAN-9.md');
    expect(brief).toContain('Critique round: 2');
    expect(brief.replace(ROLE_TEXT.trimEnd(), '')).not.toContain('continue.json');
  });
});
