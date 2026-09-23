/**
 * PAN-3920 W14 / AC-14: `pan worker run | wait | report | list`, with the
 * worker core mocked through the command's deps.
 */
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

import {
  MISSING_PARENT_MESSAGE,
  WORKER_EXIT,
  registerWorkerCommands,
  resolveWorkerParent,
  workerListCommand,
  workerReportCommand,
  workerRunCommand,
  workerWaitCommand,
  type WorkerCliDeps,
} from '../../../src/cli/commands/worker.js';
import type { WaitOutcome, WorkerReport } from '../../../src/lib/agents/worker/index.js';

const ID = 'agent-pan-9-worker-1';

function report(status: WorkerReport['status'] = 'done'): WorkerReport {
  return { seq: 1, at: '2026-09-23T12:00:00.000Z', status, body: '# Findings\nall good' };
}

function makeDeps(overrides: Partial<WorkerCliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: WorkerCliDeps = {
    startWorker: vi.fn(async () => ({ id: ID, cwd: '/ws/.swarm/worker-1', branch: 'feature/pan-9/worker-1', paneReady: true as const })),
    waitForWorkerReport: vi.fn(async (): Promise<WaitOutcome> => ({ kind: 'report', report: report() })),
    writeWorkerReport: vi.fn(async () => 3),
    listWorkers: vi.fn(async () => []),
    isAlive: vi.fn(async () => ({ alive: true as const, paneAlive: true as const })),
    stopWorker: vi.fn(async () => {}),
    workerExists: vi.fn(async () => true),
    readFile: vi.fn(async () => 'brief from file'),
    readStdin: vi.fn(async () => 'report from stdin'),
    stdinIsTTY: () => false,
    env: { OVERDECK_AGENT_ID: 'agent-pan-9-review' },
    stdout: (text) => { out.push(text); },
    stderr: (text) => { err.push(text); },
    ...overrides,
  };
  return { deps, out, err };
}

describe('pan worker run', () => {
  it('exits 0 on a done report: body on stdout, status on stderr', async () => {
    const { deps, out, err } = makeDeps();
    const code = await workerRunCommand({ issue: 'pan-9', prompt: 'Review it.' }, deps);
    expect(code).toBe(WORKER_EXIT.done);
    expect(out).toEqual(['# Findings\nall good']);
    expect(err.join('\n')).toContain(`worker ${ID} started`);
    expect(err.join('\n')).toContain('report 1: done');
    expect(deps.startWorker).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-9',
      prompt: 'Review it.',
      parentId: 'agent-pan-9-review',
      readOnly: false,
    }));
    expect(deps.waitForWorkerReport).toHaveBeenCalledWith(ID, { afterSeq: 0, timeoutMs: null });
  });

  it('exits 4 on a blocked or failed report and still prints the body', async () => {
    for (const status of ['blocked', 'failed'] as const) {
      const { deps, out } = makeDeps({ waitForWorkerReport: vi.fn(async () => ({ kind: 'report' as const, report: report(status) })) });
      expect(await workerRunCommand({ issue: 'PAN-9', prompt: 'x' }, deps)).toBe(WORKER_EXIT.blocked);
      expect(out[0]).toContain('# Findings');
    }
  });

  it('exits 2 without a report and prints the last assistant message', async () => {
    const { deps, out, err } = makeDeps({
      waitForWorkerReport: vi.fn(async () => ({ kind: 'exited-without-report' as const, lastAssistantMessage: 'I stopped here.', transcriptPath: null })),
    });
    expect(await workerRunCommand({ issue: 'PAN-9', prompt: 'x' }, deps)).toBe(WORKER_EXIT.noReport);
    expect(out).toEqual(['[no report — last assistant message]\nI stopped here.']);
    expect(err.join('\n')).toContain('exited without a report');
  });

  it('exits 2 for an idle worker and names the transcript when the dashboard is down', async () => {
    const { deps, out } = makeDeps({
      waitForWorkerReport: vi.fn(async () => ({ kind: 'idle-without-report' as const, lastAssistantMessage: null, transcriptPath: '/t.jsonl' })),
    });
    expect(await workerRunCommand({ issue: 'PAN-9', prompt: 'x' }, deps)).toBe(WORKER_EXIT.noReport);
    expect(out[0]).toContain('/t.jsonl');
  });

  it('exits 3 on timeout and says how to keep waiting', async () => {
    const { deps, err } = makeDeps({ waitForWorkerReport: vi.fn(async () => ({ kind: 'timeout' as const })) });
    expect(await workerRunCommand({ issue: 'PAN-9', prompt: 'x', timeout: '30' }, deps)).toBe(WORKER_EXIT.timeout);
    expect(deps.waitForWorkerReport).toHaveBeenCalledWith(ID, { afterSeq: 0, timeoutMs: 30_000 });
    expect(err.at(-1)).toBe(`worker ${ID} is still running; run: pan worker wait ${ID}`);
  });

  it('exits 1 on a usage or spawn error', async () => {
    expect(await workerRunCommand({ prompt: 'x' }, makeDeps().deps)).toBe(WORKER_EXIT.usage);
    expect(await workerRunCommand({ issue: 'PAN-9' }, makeDeps().deps)).toBe(WORKER_EXIT.usage);
    expect(await workerRunCommand({ issue: 'PAN-9', prompt: 'x', brief: 'b.md' }, makeDeps().deps)).toBe(WORKER_EXIT.usage);
    expect(await workerRunCommand({ issue: 'PAN-9', prompt: 'x', harness: 'nope' }, makeDeps().deps)).toBe(WORKER_EXIT.usage);
    const failing = makeDeps({
      startWorker: vi.fn(async () => { throw Object.assign(new Error('kickoff failed'), { workerId: ID }); }),
    });
    expect(await workerRunCommand({ issue: 'PAN-9', prompt: 'x' }, failing.deps)).toBe(WORKER_EXIT.usage);
    expect(failing.err.join('\n')).toContain(`pan kill ${ID}`);
  });

  it('reads the brief from --brief', async () => {
    const { deps } = makeDeps();
    await workerRunCommand({ issue: 'PAN-9', brief: 'brief.md', readOnly: true }, deps);
    expect(deps.readFile).toHaveBeenCalledWith('brief.md');
    expect(deps.startWorker).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'brief from file', readOnly: true }));
  });

  it('--detach prints only the worker id', async () => {
    const { deps, out, err } = makeDeps();
    expect(await workerRunCommand({ issue: 'PAN-9', prompt: 'x', detach: true }, deps)).toBe(0);
    expect(out).toEqual([ID]);
    expect(err).toEqual([]);
    expect(deps.waitForWorkerReport).not.toHaveBeenCalled();
  });

  it('--stop-after-report stops the worker after a report', async () => {
    const { deps } = makeDeps();
    await workerRunCommand({ issue: 'PAN-9', prompt: 'x', stopAfterReport: true }, deps);
    expect(deps.stopWorker).toHaveBeenCalledWith(ID);
  });

  it('refuses a parentless run from an agent (non-TTY) with the exact message', async () => {
    const { deps, err } = makeDeps({ env: {} });
    expect(await workerRunCommand({ issue: 'PAN-9', prompt: 'x' }, deps)).toBe(WORKER_EXIT.usage);
    expect(err).toEqual([MISSING_PARENT_MESSAGE]);
    expect(deps.startWorker).not.toHaveBeenCalled();
  });

  it('lets an interactive operator shell run without a parent', async () => {
    const { deps } = makeDeps({ env: {}, stdinIsTTY: () => true });
    expect(await workerRunCommand({ issue: 'PAN-9', prompt: 'x' }, deps)).toBe(0);
    expect(deps.startWorker).toHaveBeenCalledWith(expect.objectContaining({ parentId: null }));
  });
});

describe('parent resolution order', () => {
  it('prefers --parent, then OVERDECK_AGENT_ID, then OVERDECK_CONVERSATION', () => {
    const env = { OVERDECK_AGENT_ID: 'agent-pan-1', OVERDECK_CONVERSATION: 'conv-7' };
    expect(resolveWorkerParent('conv-x', env)).toBe('conv-x');
    expect(resolveWorkerParent(undefined, env)).toBe('agent-pan-1');
    expect(resolveWorkerParent(undefined, { OVERDECK_CONVERSATION: 'conv-7' })).toBe('conv-7');
    expect(resolveWorkerParent(undefined, {})).toBeNull();
  });
});

describe('pan worker wait', () => {
  it('passes --after and --timeout and maps the outcome', async () => {
    const { deps, err } = makeDeps({ waitForWorkerReport: vi.fn(async () => ({ kind: 'timeout' as const })) });
    expect(await workerWaitCommand(ID, { after: '2', timeout: '540' }, deps)).toBe(WORKER_EXIT.timeout);
    expect(deps.waitForWorkerReport).toHaveBeenCalledWith(ID, { afterSeq: 2, timeoutMs: 540_000 });
    expect(err.at(-1)).toBe(`worker ${ID} is still running; run: pan worker wait ${ID} --after 2`);
  });

  it('without --after waits for any report and names its seq and the next wait', async () => {
    const { deps, err } = makeDeps({
      waitForWorkerReport: vi.fn(async () => ({ kind: 'report' as const, report: { ...report(), seq: 3 } })),
    });
    expect(await workerWaitCommand(ID, {}, deps)).toBe(0);
    expect(deps.waitForWorkerReport).toHaveBeenCalledWith(ID, { afterSeq: undefined, timeoutMs: null });
    expect(err.at(-1)).toBe(`worker ${ID} report 3: done; next: pan worker wait ${ID} --after 3`);
  });

  it('rejects a non-worker id and a missing worker', async () => {
    expect(await workerWaitCommand('agent-pan-9', {}, makeDeps().deps)).toBe(WORKER_EXIT.usage);
    const { deps } = makeDeps({ workerExists: vi.fn(async () => false) });
    expect(await workerWaitCommand(ID, {}, deps)).toBe(WORKER_EXIT.usage);
  });
});

describe('pan worker report', () => {
  it('records a report from a file with a status', async () => {
    const { deps, err } = makeDeps({ env: { OVERDECK_AGENT_ID: ID } });
    expect(await workerReportCommand(ID, { file: 'r.md', status: 'blocked' }, deps)).toBe(0);
    expect(deps.writeWorkerReport).toHaveBeenCalledWith(ID, { body: 'brief from file', status: 'blocked' });
    expect(err).toEqual(['report 3 recorded']);
  });

  it('records a report from stdin, from an operator shell with no agent id', async () => {
    const { deps } = makeDeps({ env: {} });
    expect(await workerReportCommand(ID, { stdin: true }, deps)).toBe(0);
    expect(deps.writeWorkerReport).toHaveBeenCalledWith(ID, { body: 'report from stdin', status: 'done' });
  });

  it('refuses a report from another agent', async () => {
    const { deps, err } = makeDeps({ env: { OVERDECK_AGENT_ID: 'agent-pan-9-review' } });
    expect(await workerReportCommand(ID, { file: 'r.md' }, deps)).toBe(WORKER_EXIT.usage);
    expect(deps.writeWorkerReport).not.toHaveBeenCalled();
    expect(err[0]).toContain('reports only for itself');
  });

  it('rejects a bad status, both sources, and an empty body', async () => {
    expect(await workerReportCommand(ID, { file: 'r.md', status: 'meh' }, makeDeps().deps)).toBe(1);
    expect(await workerReportCommand(ID, { file: 'r.md', stdin: true }, makeDeps().deps)).toBe(1);
    expect(await workerReportCommand(ID, { stdin: true }, makeDeps({ readStdin: vi.fn(async () => '  ') }).deps)).toBe(1);
  });
});

describe('pan worker list', () => {
  it('prints JSON rows with live state and the newest report', async () => {
    const { deps, out } = makeDeps({
      listWorkers: vi.fn(async () => [{
        id: ID,
        facts: { id: ID, issueId: 'PAN-9', parentId: 'conv-7', readOnly: true, cwd: '/ws', branch: null, name: 'r', startedAt: 'x' },
        latestReport: report(),
      }]),
    });
    expect(await workerListCommand({ issue: 'pan-9', json: true }, deps)).toBe(0);
    expect(deps.listWorkers).toHaveBeenCalledWith({ issueId: 'PAN-9' });
    expect(JSON.parse(out[0]!)).toEqual([{
      id: ID,
      issue: 'PAN-9',
      parent: 'conv-7',
      name: 'r',
      readOnly: true,
      state: 'running',
      latestReport: { seq: 1, status: 'done', at: '2026-09-23T12:00:00.000Z' },
    }]);
  });
});

describe('registration', () => {
  it('pan worker --help lists run, wait, report and list', () => {
    const program = new Command();
    registerWorkerCommands(program, () => makeDeps().deps);
    const worker = program.commands.find((command) => command.name() === 'worker')!;
    expect(worker.commands.map((command) => command.name())).toEqual(['run', 'wait', 'report', 'list']);
    expect(worker.helpInformation()).toContain('run');
  });
});
