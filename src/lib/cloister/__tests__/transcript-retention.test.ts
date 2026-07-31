import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CLOISTER_CONFIG } from '../config.js';
import {
  isTranscriptRetentionTerminalAgent,
  sweepTranscriptRetention,
} from '../transcript-retention.js';

const NOW = new Date('2026-07-31T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

let agentsDir: string;

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

    await expect(sweepTranscriptRetention({
      transcriptDays: undefined,
      agentsDir,
      deps: { readDir },
    })).resolves.toEqual([]);
    expect(DEFAULT_CLOISTER_CONFIG.retention).not.toHaveProperty('transcript_days');
    expect(readDir).not.toHaveBeenCalled();
  });

  it('deletes only jsonl older than N days for ended agents', async () => {
    const endedDir = join(agentsDir, 'conv-ended', 'sessions');
    const activeDir = join(agentsDir, 'conv-active', 'sessions');
    const archivedDir = join(agentsDir, 'conv-archived', 'sessions');
    mkdirSync(endedDir, { recursive: true });
    mkdirSync(activeDir, { recursive: true });
    mkdirSync(archivedDir, { recursive: true });

    const oldEnded = join(endedDir, 'old.jsonl');
    const newEnded = join(endedDir, 'new.jsonl');
    const oldActive = join(activeDir, 'old.jsonl');
    const oldArchived = join(archivedDir, 'old.jsonl');
    writeFileSync(oldEnded, '{}\n');
    writeFileSync(newEnded, '{}\n');
    writeFileSync(oldActive, '{}\n');
    writeFileSync(oldArchived, '{}\n');
    const oldTime = new Date(NOW.getTime() - 3 * DAY_MS);
    const newTime = new Date(NOW.getTime() - DAY_MS);
    utimesSync(oldEnded, oldTime, oldTime);
    utimesSync(newEnded, newTime, newTime);
    utimesSync(oldActive, oldTime, oldTime);
    utimesSync(oldArchived, oldTime, oldTime);
    const listSessionNames = vi.fn(async () => []);
    const listConversations = vi.fn(() => [
      { name: 'ended', status: 'ended' as const, archivedAt: null },
      { name: 'active', status: 'active' as const, archivedAt: null },
    ]);
    const listArchivedConversations = vi.fn(() => [
      { name: 'archived', status: 'ended' as const, archivedAt: '2026-07-30T00:00:00.000Z' },
    ]);

    const actions = await sweepTranscriptRetention({
      transcriptDays: 2,
      agentsDir,
      deps: {
        listSessionNames,
        listConversations,
        listArchivedConversations,
        log: vi.fn(),
      },
    });

    expect(existsSync(oldEnded)).toBe(false);
    expect(existsSync(newEnded)).toBe(true);
    expect(existsSync(oldActive)).toBe(true);
    expect(existsSync(oldArchived)).toBe(false);
    expect(listSessionNames).toHaveBeenCalledTimes(1);
    expect(listConversations).toHaveBeenCalledTimes(1);
    expect(listArchivedConversations).toHaveBeenCalledTimes(1);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('deleted 2 transcript files');
  });

  it('never touches dirs with a live tmux session', async () => {
    const sessionDir = join(agentsDir, 'agent-pan-3357', 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const transcriptPath = join(sessionDir, 'old.jsonl');
    writeFileSync(transcriptPath, '{}\n');
    const oldTime = new Date(NOW.getTime() - 30 * DAY_MS);
    utimesSync(transcriptPath, oldTime, oldTime);
    const listConversations = vi.fn();
    const listAgents = vi.fn();

    const actions = await sweepTranscriptRetention({
      transcriptDays: 2,
      agentsDir,
      deps: {
        listSessionNames: vi.fn(async () => ['agent-pan-3357']),
        listConversations,
        listArchivedConversations: vi.fn(),
        listAgents,
        log: vi.fn(),
      },
    });

    expect(existsSync(transcriptPath)).toBe(true);
    expect(listConversations).not.toHaveBeenCalled();
    expect(listAgents).not.toHaveBeenCalled();
    expect(actions[0]).toContain('deleted 0 transcript files');
  });

  it('deletes expired transcripts only after terminal agent state is established', async () => {
    const sessionDir = join(agentsDir, 'agent-pan-3357', 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const transcriptPath = join(sessionDir, 'old.jsonl');
    writeFileSync(transcriptPath, '{}\n');
    const oldTime = new Date(NOW.getTime() - 30 * DAY_MS);
    utimesSync(transcriptPath, oldTime, oldTime);
    const agent = {
      id: 'agent-pan-3357',
      issueId: 'PAN-3357',
      status: 'stopped',
      workspace: '/tmp/feature-pan-3357',
      paused: false,
      troubled: false,
      stoppedByUser: false,
    };

    const listAgents = vi.fn(() => [agent]);
    const isTerminalAgent = vi.fn((candidate) => isTranscriptRetentionTerminalAgent(
      candidate,
      () => ({ pipeline: { closedOut: true } }),
    ));
    expect(isTerminalAgent(agent)).toBe(true);

    const actions = await sweepTranscriptRetention({
      transcriptDays: 2,
      agentsDir,
      deps: {
        listSessionNames: vi.fn(async () => []),
        listAgents,
        isTerminalAgent,
        listConversations: vi.fn(),
        listArchivedConversations: vi.fn(),
        log: vi.fn(),
      },
    });

    expect(existsSync(transcriptPath)).toBe(false);
    expect(actions[0]).toContain('deleted 1 transcript file');
  });

  it('retains transcripts for a registered paused agent without a live session', async () => {
    const sessionDir = join(agentsDir, 'agent-pan-3357', 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const transcriptPath = join(sessionDir, 'old.jsonl');
    writeFileSync(transcriptPath, '{}\n');
    const oldTime = new Date(NOW.getTime() - 30 * DAY_MS);
    utimesSync(transcriptPath, oldTime, oldTime);
    const listAgents = vi.fn(() => [{
      id: 'agent-pan-3357',
      issueId: 'PAN-3357',
      status: 'stopped',
      workspace: '/tmp/feature-pan-3357',
      paused: true,
      troubled: false,
      stoppedByUser: false,
    }]);
    const isTerminalAgent = vi.fn((agent) => isTranscriptRetentionTerminalAgent(
      agent,
      () => ({ pipeline: { closedOut: true } }),
    ));

    const actions = await sweepTranscriptRetention({
      transcriptDays: 2,
      agentsDir,
      deps: {
        listSessionNames: vi.fn(async () => []),
        listAgents,
        isTerminalAgent,
        listConversations: vi.fn(),
        listArchivedConversations: vi.fn(),
        log: vi.fn(),
      },
    });

    expect(existsSync(transcriptPath)).toBe(true);
    expect(listAgents).toHaveBeenCalledTimes(1);
    expect(isTerminalAgent).toHaveBeenCalledTimes(1);
    expect(actions[0]).toContain('deleted 0 transcript files');
  });

  it('fails closed when the canonical agent registry cannot be read', async () => {
    const sessionDir = join(agentsDir, 'agent-pan-3357', 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const transcriptPath = join(sessionDir, 'old.jsonl');
    writeFileSync(transcriptPath, '{}\n');
    const oldTime = new Date(NOW.getTime() - 30 * DAY_MS);
    utimesSync(transcriptPath, oldTime, oldTime);

    const actions = await sweepTranscriptRetention({
      transcriptDays: 2,
      agentsDir,
      deps: {
        listSessionNames: vi.fn(async () => []),
        listAgents: vi.fn(() => { throw new Error('registry unavailable'); }),
        listConversations: vi.fn(),
        listArchivedConversations: vi.fn(),
        log: vi.fn(),
      },
    });

    expect(existsSync(transcriptPath)).toBe(true);
    expect(actions[0]).toContain('deleted 0 transcript files');
  });
});
