import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CLOISTER_CONFIG } from '../config.js';
import { sweepTranscriptRetention } from '../transcript-retention.js';

const NOW = new Date('2026-09-20T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

let agentsDir: string;

function retentionDeps(liveSessions: string[] = []) {
  return {
    listLiveAgentIds: vi.fn(async () => new Set(liveSessions)),
    listConversations: vi.fn(() => []),
    listArchivedConversations: vi.fn(() => []),
    log: vi.fn(),
  };
}

function writeArtifact(path: string, ageDays: number): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '{}\n');
  const time = new Date(NOW.getTime() - ageDays * DAY_MS);
  utimesSync(path, time, time);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  agentsDir = mkdtempSync(join(tmpdir(), 'transcript-retention-'));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(agentsDir, { recursive: true, force: true });
});

describe('sweepTranscriptRetention', () => {
  it('does not run when transcript_days is unset', async () => {
    const readDir = vi.fn();
    await expect(sweepTranscriptRetention({ transcriptDays: undefined, agentsDir, deps: { readDir } }))
      .resolves.toEqual([]);
    expect(DEFAULT_CLOISTER_CONFIG.retention).not.toHaveProperty('transcript_days');
    expect(readDir).not.toHaveBeenCalled();
  });

  it('removes an orphan agent dir whose only rollouts are expired', async () => {
    const agentDir = join(agentsDir, 'agent-pan-3950');
    const rollout = join(agentDir, 'codex-home-v2', 'sessions', '2026', '08', '01', 'rollout-old.jsonl');
    writeArtifact(rollout, 60);

    const actions = await sweepTranscriptRetention({
      transcriptDays: 30,
      agentsDir,
      deps: retentionDeps(),
    });

    expect(existsSync(agentDir)).toBe(false);
    expect(actions[0]).toContain('deleted 1 transcript file');
  });

  it('keeps the whole agent dir when activity.jsonl is newer than the cutoff', async () => {
    const agentDir = join(agentsDir, 'agent-pan-3950');
    const rollout = join(agentDir, 'codex-home', 'sessions', '2026', '08', '01', 'rollout-old.jsonl');
    const activity = join(agentDir, 'activity.jsonl');
    writeArtifact(rollout, 60);
    writeArtifact(activity, 1);

    await sweepTranscriptRetention({ transcriptDays: 30, agentsDir, deps: retentionDeps() });

    expect(existsSync(agentDir)).toBe(true);
    expect(existsSync(rollout)).toBe(true);
    expect(existsSync(activity)).toBe(true);
  });

  it('keeps a young rollout even when no state or registry entry exists', async () => {
    const agentDir = join(agentsDir, 'agent-pan-3950-review');
    const rollout = join(agentDir, 'codex-home', 'sessions', '2026', '09', '19', 'rollout-young.jsonl');
    writeArtifact(rollout, 1);

    await sweepTranscriptRetention({ transcriptDays: 30, agentsDir, deps: retentionDeps() });

    expect(existsSync(agentDir)).toBe(true);
    expect(existsSync(rollout)).toBe(true);
  });

  it('never touches an agent dir with a live tmux session', async () => {
    const agentDir = join(agentsDir, 'agent-pan-3950');
    const rollout = join(agentDir, 'codex-home', 'sessions', '2026', '08', '01', 'rollout-old.jsonl');
    writeArtifact(rollout, 60);

    await sweepTranscriptRetention({
      transcriptDays: 30,
      agentsDir,
      deps: retentionDeps(['agent-pan-3950']),
    });

    expect(existsSync(rollout)).toBe(true);
  });

  it('fails closed when backend liveness inventory is indeterminate', async () => {
    const agentDir = join(agentsDir, 'agent-pan-3950');
    const rollout = join(agentDir, 'codex-home', 'sessions', '2026', '08', '01', 'rollout-old.jsonl');
    writeArtifact(rollout, 60);
    const deps = retentionDeps();
    deps.listLiveAgentIds.mockResolvedValue(null);

    const actions = await sweepTranscriptRetention({ transcriptDays: 30, agentsDir, deps });

    expect(existsSync(rollout)).toBe(true);
    expect(actions).toEqual(['Transcript retention sweep skipped: backend liveness inventory unavailable']);
  });

  it('restores ended and archived conversation pruning while preserving active history', async () => {
    const ended = join(agentsDir, 'conv-ended', 'sessions', 'old.jsonl');
    const active = join(agentsDir, 'conv-active', 'sessions', 'old.jsonl');
    const archived = join(agentsDir, 'conv-archived', 'sessions', 'old.jsonl');
    writeArtifact(ended, 60);
    writeArtifact(active, 60);
    writeArtifact(archived, 60);
    const deps = retentionDeps();
    deps.listConversations.mockReturnValue([
      { name: 'ended', status: 'ended', archivedAt: null },
      { name: 'active', status: 'active', archivedAt: null },
    ]);
    deps.listArchivedConversations.mockReturnValue([
      { name: 'archived', status: 'ended', archivedAt: NOW.toISOString() },
    ]);

    await sweepTranscriptRetention({ transcriptDays: 30, agentsDir, deps });

    expect(existsSync(ended)).toBe(false);
    expect(existsSync(archived)).toBe(false);
    expect(existsSync(active)).toBe(true);
  });

  it('fails closed for conversation directories when their registry is unavailable', async () => {
    const transcript = join(agentsDir, 'conv-ended', 'sessions', 'old.jsonl');
    writeArtifact(transcript, 60);
    const deps = retentionDeps();
    deps.listConversations.mockImplementation(() => { throw new Error('registry unavailable'); });

    await sweepTranscriptRetention({ transcriptDays: 30, agentsDir, deps });

    expect(existsSync(transcript)).toBe(true);
  });

  it('keeps a fresh transcript first and expires it after the configured window', async () => {
    const agentDir = join(agentsDir, 'agent-pan-3950');
    const rollout = join(agentDir, 'codex-home', 'sessions', '2026', '09', '19', 'rollout.jsonl');
    writeArtifact(rollout, 1);

    await sweepTranscriptRetention({ transcriptDays: 2, agentsDir, deps: retentionDeps() });
    expect(existsSync(rollout)).toBe(true);

    await vi.advanceTimersByTimeAsync(2 * DAY_MS);
    await sweepTranscriptRetention({ transcriptDays: 2, agentsDir, deps: retentionDeps() });
    expect(existsSync(agentDir)).toBe(false);
  });
});
