/**
 * PAN-3920 W19 / AC-19: `pan worker register` maps its flags onto the one
 * registration core, rejects the adapter's reserved source, and a repeat
 * registration prints the existing id.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WORKER_EXIT, workerRegisterCommand, type WorkerCliDeps } from '../../../src/cli/commands/worker.js';
import { registerFromBody } from '../../../src/dashboard/server/routes/workers-register.js';
import { performExternalRegistration, type ExternalRegisterRequest } from '../../../src/lib/agents/external-register.js';
import { ExternalPathError } from '../../../src/lib/agents/external-registry.js';

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

  /** A transcript under ~/.overdeck/agents, one of the allowed transcript roots. */
  function transcript(name: string): string {
    const dir = join(home, 'agents', 'fixtures');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), '');
    return join(dir, name);
  }

  function request(path: string | null, sessionId = 'thread-1'): ExternalRegisterRequest {
    return {
      input: { source: 'my-tool', externalId: 'run-7', harness: 'codex', model: null, cwd: null, issueId: null, parentId: null, label: null, pid: 4242, logFile: null },
      transcript: { sessionId, path },
    };
  }

  it('records the pid start time and the transcript once; a repeat writes nothing', async () => {
    const rollout = transcript('rollout-thread-1.jsonl');
    const readPidStartTime = vi.fn(async () => '9001');
    expect(await performExternalRegistration(request(rollout), { readPidStartTime })).toEqual({ id: 'ext-my-tool-run-7', created: true });
    const dir = join(home, 'agents', 'ext-my-tool-run-7');
    expect(JSON.parse(readFileSync(join(dir, 'registration.json'), 'utf8'))).toMatchObject({ pid: 4242, pidStartTime: '9001' });
    const index = readFileSync(join(dir, 'sessions.json'), 'utf8');
    expect(index).toContain(rollout);

    const again = await performExternalRegistration(request(transcript('other.jsonl'), 'thread-2'), { readPidStartTime });
    expect(again).toEqual({ id: 'ext-my-tool-run-7', created: false });
    expect(readFileSync(join(dir, 'sessions.json'), 'utf8')).toBe(index);
  });

  it('links the transcript on a retry when the first attempt registered without linking it', async () => {
    const readPidStartTime = vi.fn(async () => '9001');
    // First attempt: the registration landed, the transcript append did not.
    expect(await performExternalRegistration(request(null), { readPidStartTime })).toMatchObject({ created: true });
    const dir = join(home, 'agents', 'ext-my-tool-run-7');
    expect(existsSync(join(dir, 'sessions.json'))).toBe(true); // session id only, no path
    expect(readFileSync(join(dir, 'sessions.json'), 'utf8')).not.toContain('"path"');

    const rollout = transcript('rollout-thread-1.jsonl');
    expect(await performExternalRegistration(request(rollout), { readPidStartTime })).toEqual({ id: 'ext-my-tool-run-7', created: false });
    expect(readFileSync(join(dir, 'sessions.json'), 'utf8')).toContain(rollout);
  });

  it('refuses a transcript outside the roots before writing anything', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'worker-register-outside-'));
    try {
      const secret = join(outside, 'secret.jsonl');
      writeFileSync(secret, '');
      await expect(performExternalRegistration(request(secret), { readPidStartTime: async () => null }))
        .rejects.toBeInstanceOf(ExternalPathError);
      expect(existsSync(join(home, 'agents', 'ext-my-tool-run-7'))).toBe(false);

      const result = await registerFromBody({ source: 'my-tool', externalId: 'run-7', harness: 'codex', transcript: secret });
      expect(result).toMatchObject({ status: 400, body: { error: expect.stringMatching(/outside the allowed directories/) } });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
