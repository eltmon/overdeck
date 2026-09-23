/**
 * PAN-3920 W18 — the external agent registry: write-once registrations, the
 * sessions.json transcript link, D21 liveness and transcript completion.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  externalAgentId,
  externalLiveness,
  listExternalRegistrations,
  parseProcStatStartTime,
  readExternalRegistration,
  recordExternalTranscript,
  registerExternalAgent,
  transcriptTurnComplete,
  type ExternalRegistrationInput,
  type ProcReader,
} from '../external-registry.js';
import { listAgentTranscriptCandidates } from '../transcript-resolver.js';

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.OVERDECK_HOME;
  home = mkdtempSync(join(tmpdir(), 'external-registry-'));
  process.env.OVERDECK_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

function input(overrides: Partial<ExternalRegistrationInput> = {}): ExternalRegistrationInput {
  return {
    source: 'codex-plugin',
    externalId: 'task-mu9b1x4e-bqx80g',
    harness: 'codex',
    model: 'gpt-5.6-sol',
    cwd: '/home/op/Projects/overdeck/workspaces/feature-pan-1',
    issueId: 'PAN-1',
    parentId: 'conv-alpha',
    label: 'Fix the flake',
    pid: 4242,
    pidStartTime: '9001',
    logFile: null,
    ...overrides,
  };
}

const STAT = (start: string) => `4242 (codex (x) worker) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 ${start} 20 21\n`;

function proc(overrides: Partial<ProcReader> = {}): ProcReader {
  return {
    readStat: async () => STAT('9001'),
    hasProc: async () => true,
    signalZero: () => false,
    ...overrides,
  };
}

describe('externalAgentId', () => {
  it('keeps a clean external id verbatim', () => {
    expect(externalAgentId('codex-plugin', 'task-mu9b1x4e-bqx80g')).toBe('ext-codex-plugin-task-mu9b1x4e-bqx80g');
  });

  it('adds a hash when the id had to be slugified, so distinct ids never collide', () => {
    const a = externalAgentId('my-tool', 'Job_1');
    const b = externalAgentId('my-tool', 'job-1');
    expect(a).toMatch(/^ext-my-tool-job-1-[0-9a-f]{8}$/);
    expect(b).toBe('ext-my-tool-job-1');
    expect(a).not.toBe(b);
    expect(externalAgentId('my-tool', 'x'.repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe('registerExternalAgent', () => {
  it('writes once; a second registration returns the same id and leaves the file byte-identical', async () => {
    const first = await registerExternalAgent(input(), () => new Date('2026-09-23T10:00:00.000Z'));
    expect(first).toEqual({ id: 'ext-codex-plugin-task-mu9b1x4e-bqx80g', created: true });
    const file = join(home, 'agents', first.id, 'registration.json');
    const before = readFileSync(file);

    const second = await registerExternalAgent(input({ label: 'different' }), () => new Date('2026-09-24T00:00:00.000Z'));
    expect(second).toEqual({ id: first.id, created: false });
    expect(readFileSync(file).equals(before)).toBe(true);

    const registration = await readExternalRegistration(first.id);
    expect(registration).toMatchObject({ source: 'codex-plugin', label: 'Fix the flake', registeredAt: '2026-09-23T10:00:00.000Z' });
  });

  it('records any other source as a registered entry and keeps the caller name', async () => {
    const { id } = await registerExternalAgent(input({ source: 'my-tool', externalId: 'run-7' }));
    expect(await readExternalRegistration(id)).toMatchObject({ id: 'ext-my-tool-run-7', source: 'registered', registeredBy: 'my-tool' });
  });

  it('rejects an invalid source before touching disk', async () => {
    await expect(registerExternalAgent(input({ source: '../x' }))).rejects.toThrow(/invalid source/);
  });
});

describe('recordExternalTranscript', () => {
  it('makes the agent transcript resolver return the recorded path, and a repeat writes nothing', async () => {
    const { id } = await registerExternalAgent(input());
    const rollout = join(home, 'rollout-2026-09-23T10-00-00-thread-1.jsonl');
    writeFileSync(rollout, '');

    expect(await recordExternalTranscript(id, { sessionId: 'thread-1', harness: 'codex', model: 'gpt-5.6-sol', path: rollout })).toBe(true);
    const index = readFileSync(join(home, 'agents', id, 'sessions.json'), 'utf8');
    expect(await recordExternalTranscript(id, { sessionId: 'thread-1', harness: 'codex', path: rollout })).toBe(false);
    expect(readFileSync(join(home, 'agents', id, 'sessions.json'), 'utf8')).toBe(index);

    const candidates = await listAgentTranscriptCandidates(id, '', { logDiagnostic: () => {} });
    expect(candidates[0]).toMatchObject({ kind: 'codex', path: rollout });
  });
});

describe('listExternalRegistrations', () => {
  it('lists ext-* registrations and skips other and malformed directories', async () => {
    await registerExternalAgent(input());
    mkdirSync(join(home, 'agents', 'agent-pan-1'), { recursive: true });
    mkdirSync(join(home, 'agents', 'ext-broken'), { recursive: true });
    writeFileSync(join(home, 'agents', 'ext-broken', 'registration.json'), '{not json');
    const ids = (await listExternalRegistrations()).map((registration) => registration.id);
    expect(ids).toEqual(['ext-codex-plugin-task-mu9b1x4e-bqx80g']);
  });
});

describe('externalLiveness (D21)', () => {
  it('parses field 22 even when the command name holds spaces and parens', () => {
    expect(parseProcStatStartTime(STAT('777'))).toBe('777');
  });

  it('is alive when the pid exists with the recorded start time', async () => {
    expect(await externalLiveness({ pid: 4242, pidStartTime: '9001' }, proc())).toBe('alive');
  });

  it('is dead when the pid was reused by a process with another start time', async () => {
    expect(await externalLiveness({ pid: 4242, pidStartTime: '9001' }, proc({ readStat: async () => STAT('12345') }))).toBe('dead');
  });

  it('is dead when the pid no longer exists', async () => {
    expect(await externalLiveness({ pid: 4242, pidStartTime: '9001' }, proc({ readStat: async () => null }))).toBe('dead');
  });

  it('is unknown without a pid, or with a pid but no recorded start time', async () => {
    expect(await externalLiveness({ pid: null, pidStartTime: null }, proc())).toBe('unknown');
    expect(await externalLiveness({ pid: 4242, pidStartTime: null }, proc())).toBe('unknown');
  });

  it('falls back to signal 0 without /proc', async () => {
    const noProc = proc({ hasProc: async () => false, readStat: async () => { throw new Error('no /proc'); } });
    expect(await externalLiveness({ pid: 4242, pidStartTime: null }, { ...noProc, signalZero: () => true })).toBe('alive');
    expect(await externalLiveness({ pid: 4242, pidStartTime: null }, noProc)).toBe('dead');
  });
});

describe('transcriptTurnComplete', () => {
  const event = (type: string) => JSON.stringify({ type: 'event_msg', payload: { type } });

  it('reads a Codex rollout by its newest task event', async () => {
    const done = join(home, 'done.jsonl');
    const running = join(home, 'running.jsonl');
    writeFileSync(done, [event('task_started'), event('task_complete')].join('\n'));
    writeFileSync(running, [event('task_complete'), event('task_started')].join('\n'));
    expect(await transcriptTurnComplete('codex', done)).toBe(true);
    expect(await transcriptTurnComplete('codex', running)).toBe(false);
  });

  it('reads a Claude transcript by the last assistant stop_reason', async () => {
    const assistant = (stop: string | null) => JSON.stringify({ type: 'assistant', message: { stop_reason: stop } });
    const done = join(home, 'claude-done.jsonl');
    const mid = join(home, 'claude-mid.jsonl');
    writeFileSync(done, [assistant('tool_use'), JSON.stringify({ type: 'user' }), assistant('end_turn'), ''].join('\n'));
    writeFileSync(mid, [assistant('end_turn'), JSON.stringify({ type: 'user' }), assistant('tool_use')].join('\n'));
    expect(await transcriptTurnComplete('claude', done)).toBe(true);
    expect(await transcriptTurnComplete('claude', mid)).toBe(false);
  });

  it('answers false for other kinds and missing files', async () => {
    expect(await transcriptTurnComplete('pi', join(home, 'x.jsonl'))).toBe(false);
    expect(await transcriptTurnComplete('claude', join(home, 'missing.jsonl'))).toBe(false);
  });
});
