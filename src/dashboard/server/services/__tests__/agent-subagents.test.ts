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
  await writeFile(subagentFile, '{}\n');
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
    expect(subagents[0]).toMatchObject({ agentId: 'a1', agentType: 'Explore', transcriptPath: subagentFile });
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
