/**
 * PAN-3920 W2 — subagents of a native agent, read beside the agent's own
 * transcript. The parent transcript resolution is mocked; the subagent files
 * are real files in a temp dir.
 */
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveAgentTranscriptCandidate = vi.fn();
vi.mock('../../../../lib/agents/transcript-resolver.js', () => ({
  resolveAgentTranscriptCandidate: (...args: unknown[]) => resolveAgentTranscriptCandidate(...args),
}));

// Count directory walks: the Codex listing must walk the sessions tree once.
const readdirCalls: string[] = [];
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readdir: ((path: string, ...rest: unknown[]) => {
      readdirCalls.push(String(path));
      return (actual.readdir as (...args: unknown[]) => unknown)(path, ...rest);
    }) as typeof actual.readdir,
  };
});

import { listAgentSubagents, resolveAgentSubagentTranscript } from '../agent-subagents.js';

const NOW = new Date('2026-09-23T12:00:00.000Z');
let root: string;
let parentFile: string;
let subagentFile: string;

async function setMtime(path: string, msAgo: number): Promise<void> {
  const at = new Date(NOW.getTime() - msAgo);
  await utimes(path, at, at);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  root = await mkdtemp(join(tmpdir(), 'agent-subagents-'));
  parentFile = join(root, 'session-1.jsonl');
  await writeFile(parentFile, '');
  await mkdir(join(root, 'session-1', 'subagents'), { recursive: true });
  subagentFile = join(root, 'session-1', 'subagents', 'agent-a1.jsonl');
  await writeFile(subagentFile, `${JSON.stringify({ type: 'assistant', message: { model: 'claude-haiku-5' } })}\n`);
  await writeFile(
    join(root, 'session-1', 'subagents', 'agent-a1.meta.json'),
    JSON.stringify({ agentType: 'Explore', description: 'find the route', toolUseId: 'toolu_1', spawnDepth: 1 }),
  );
  resolveAgentTranscriptCandidate.mockResolvedValue({ kind: 'claude', path: parentFile });
});

afterEach(async () => {
  vi.useRealTimers();
  resolveAgentTranscriptCandidate.mockReset();
  await rm(root, { recursive: true, force: true });
});

describe('listAgentSubagents', () => {
  it('lists a Claude subagent with its transcript path', async () => {
    await setMtime(subagentFile, 10_000);
    const subagents = await listAgentSubagents('agent-pan-1', '/w');
    expect(subagents).toHaveLength(1);
    expect(subagents[0]).toMatchObject({ agentId: 'a1', agentType: 'Explore', transcriptPath: subagentFile, model: 'claude-haiku-5' });
  });

  it('is running when the transcript changed 10 s ago and done after 10 min', async () => {
    await setMtime(subagentFile, 10_000);
    expect((await listAgentSubagents('agent-pan-1', '/w'))[0]?.status).toBe('running');
    await setMtime(subagentFile, 10 * 60_000);
    expect((await listAgentSubagents('agent-pan-1', '/w'))[0]?.status).toBe('done');
  });

  it('answers [] when the agent has no transcript or a harness without subagents', async () => {
    resolveAgentTranscriptCandidate.mockResolvedValueOnce(null);
    expect(await listAgentSubagents('agent-pan-1', '/w')).toEqual([]);
    resolveAgentTranscriptCandidate.mockResolvedValueOnce({ kind: 'kimi', path: parentFile });
    expect(await listAgentSubagents('agent-pan-1', '/w')).toEqual([]);
  });
});

describe('resolveAgentSubagentTranscript', () => {
  it('resolves a Claude subagent file', async () => {
    expect(await resolveAgentSubagentTranscript('agent-pan-1', '/w', 'a1')).toEqual({ kind: 'claude', path: subagentFile });
  });

  it('rejects a path-traversal id and an unknown id', async () => {
    expect(await resolveAgentSubagentTranscript('agent-pan-1', '/w', '../x')).toBeNull();
    expect(await resolveAgentSubagentTranscript('agent-pan-1', '/w', 'missing')).toBeNull();
    expect(resolveAgentTranscriptCandidate).toHaveBeenCalledTimes(1);
  });
});

describe('listAgentSubagents — Codex', () => {
  async function rollout(dir: string, name: string, payload: Record<string, unknown>): Promise<string> {
    const file = join(dir, name);
    await writeFile(file, `${JSON.stringify({ type: 'session_meta', payload })}\n`);
    return file;
  }

  it('lists every child from one walk of the sessions tree, state from mtime', async () => {
    const day = join(root, 'codex-home', 'sessions', '2026', '09', '23');
    await mkdir(day, { recursive: true });
    const parent = await rollout(day, 'rollout-parent.jsonl', { id: 'thread-parent' });
    const childA = await rollout(day, 'rollout-a.jsonl', {
      id: 'thread-a', source: { subagent: { thread_spawn: { parent_thread_id: 'thread-parent', agent_role: 'explorer' } } },
    });
    const childB = await rollout(day, 'rollout-b.jsonl', {
      id: 'thread-b', source: { subagent: { thread_spawn: { parent_thread_id: 'thread-parent', agent_role: 'worker' } } },
    });
    await setMtime(childA, 10_000);
    await setMtime(childB, 10 * 60_000);
    resolveAgentTranscriptCandidate.mockResolvedValue({ kind: 'codex', path: parent });

    readdirCalls.length = 0;
    const subagents = await listAgentSubagents('agent-pan-1', '/w');
    expect(subagents.map((sub) => [sub.agentId, sub.agentType, sub.status, sub.transcriptPath])).toEqual([
      ['thread-a', 'explorer', 'running', childA],
      ['thread-b', 'worker', 'done', childB],
    ]);
    // One walk: the sessions root is read once, not once more per child.
    expect(readdirCalls.filter((path) => path.endsWith('/sessions'))).toHaveLength(1);
  });
});
