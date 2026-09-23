/**
 * PAN-3920 W19 / AC-19: `pan worker register` maps its flags onto the one
 * registration core, rejects the adapter's reserved source, and a repeat
 * registration prints the existing id.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WORKER_EXIT, workerRegisterCommand, type WorkerCliDeps } from '../../../src/cli/commands/worker.js';
import { performExternalRegistration, type ExternalRegisterRequest } from '../../../src/lib/agents/external-register.js';

function makeDeps(registerExternal: WorkerCliDeps['registerExternal']) {
  const out: string[] = [];
  const err: string[] = [];
  const deps = {
    registerExternal,
    cwd: () => '/home/op/Projects/overdeck',
    stdout: (text: string) => { out.push(text); },
    stderr: (text: string) => { err.push(text); },
  } as unknown as WorkerCliDeps;
  return { deps, out, err };
}

describe('pan worker register', () => {
  it('maps every flag onto the registration core and prints the id', async () => {
    const register = vi.fn(async (_request: ExternalRegisterRequest) => ({ id: 'ext-my-tool-run-7', created: true }));
    const { deps, out } = makeDeps(register);
    const code = await workerRegisterCommand({
      source: 'my-tool',
      externalId: 'run-7',
      harness: 'codex',
      model: 'gpt-5.5',
      cwd: 'workspaces/feature-pan-9',
      issue: 'pan-9',
      parent: 'conv-orchestrator',
      label: 'Second opinion',
      pid: '4242',
      transcript: '/home/op/.codex/sessions/2026/09/23/rollout-x-thread-1.jsonl',
    }, deps);

    expect(code).toBe(WORKER_EXIT.done);
    expect(out).toEqual(['ext-my-tool-run-7']);
    expect(register).toHaveBeenCalledWith({
      input: {
        source: 'my-tool',
        externalId: 'run-7',
        harness: 'codex',
        model: 'gpt-5.5',
        cwd: '/home/op/Projects/overdeck/workspaces/feature-pan-9',
        issueId: 'PAN-9',
        parentId: 'conv-orchestrator',
        label: 'Second opinion',
        pid: 4242,
        logFile: null,
      },
      transcript: { sessionId: 'rollout-x-thread-1', path: '/home/op/.codex/sessions/2026/09/23/rollout-x-thread-1.jsonl' },
    });
  });

  it('rejects the reserved codex-plugin source', async () => {
    const register = vi.fn();
    const { deps, err } = makeDeps(register);
    const code = await workerRegisterCommand({ source: 'codex-plugin', externalId: 'task-1', harness: 'codex' }, deps);
    expect(code).toBe(WORKER_EXIT.usage);
    expect(err.join('\n')).toMatch(/reserved/);
    expect(register).not.toHaveBeenCalled();
  });

  it('prints { id, created } with --json', async () => {
    const { deps, out } = makeDeps(vi.fn(async () => ({ id: 'ext-my-tool-run-7', created: false })));
    await workerRegisterCommand({ source: 'my-tool', externalId: 'run-7', harness: 'codex', json: true }, deps);
    expect(JSON.parse(out[0]!)).toEqual({ id: 'ext-my-tool-run-7', created: false });
  });
});

describe('performExternalRegistration', () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.OVERDECK_HOME;
    home = mkdtempSync(join(tmpdir(), 'worker-register-'));
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('records the pid start time and the transcript once; a repeat writes nothing', async () => {
    const request: ExternalRegisterRequest = {
      input: { source: 'my-tool', externalId: 'run-7', harness: 'codex', model: null, cwd: null, issueId: null, parentId: null, label: null, pid: 4242, logFile: null },
      transcript: { sessionId: 'thread-1', path: '/tmp/rollout-thread-1.jsonl' },
    };
    const readPidStartTime = vi.fn(async () => '9001');
    expect(await performExternalRegistration(request, { readPidStartTime })).toEqual({ id: 'ext-my-tool-run-7', created: true });
    const dir = join(home, 'agents', 'ext-my-tool-run-7');
    expect(JSON.parse(readFileSync(join(dir, 'registration.json'), 'utf8'))).toMatchObject({ pid: 4242, pidStartTime: '9001' });
    const index = readFileSync(join(dir, 'sessions.json'), 'utf8');
    expect(index).toContain('/tmp/rollout-thread-1.jsonl');

    const again = await performExternalRegistration({ ...request, transcript: { sessionId: 'thread-2', path: '/tmp/other.jsonl' } }, { readPidStartTime });
    expect(again).toEqual({ id: 'ext-my-tool-run-7', created: false });
    expect(readFileSync(join(dir, 'sessions.json'), 'utf8')).toBe(index);
  });
});
