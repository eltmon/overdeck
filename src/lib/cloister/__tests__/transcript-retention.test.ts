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
    listSessionNames: vi.fn(async () => liveSessions),
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
});
