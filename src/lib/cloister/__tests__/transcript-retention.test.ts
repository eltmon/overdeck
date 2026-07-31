import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CLOISTER_CONFIG } from '../config.js';
import { sweepTranscriptRetention } from '../transcript-retention.js';

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
    mkdirSync(endedDir, { recursive: true });
    mkdirSync(activeDir, { recursive: true });

    const oldEnded = join(endedDir, 'old.jsonl');
    const newEnded = join(endedDir, 'new.jsonl');
    const oldActive = join(activeDir, 'old.jsonl');
    writeFileSync(oldEnded, '{}\n');
    writeFileSync(newEnded, '{}\n');
    writeFileSync(oldActive, '{}\n');
    const oldTime = new Date(NOW.getTime() - 3 * DAY_MS);
    const newTime = new Date(NOW.getTime() - DAY_MS);
    utimesSync(oldEnded, oldTime, oldTime);
    utimesSync(newEnded, newTime, newTime);
    utimesSync(oldActive, oldTime, oldTime);

    const actions = await sweepTranscriptRetention({
      transcriptDays: 2,
      agentsDir,
      deps: {
        sessionExists: vi.fn(async () => false),
        getConversationByName: vi.fn((name: string) => ({
          status: name === 'conv-ended' ? 'ended' : 'active',
          archivedAt: null,
        })),
        log: vi.fn(),
      },
    });

    expect(existsSync(oldEnded)).toBe(false);
    expect(existsSync(newEnded)).toBe(true);
    expect(existsSync(oldActive)).toBe(true);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('deleted 1 transcript file');
  });

  it('never touches dirs with a live tmux session', async () => {
    const sessionDir = join(agentsDir, 'agent-pan-3357', 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const transcriptPath = join(sessionDir, 'old.jsonl');
    writeFileSync(transcriptPath, '{}\n');
    const oldTime = new Date(NOW.getTime() - 30 * DAY_MS);
    utimesSync(transcriptPath, oldTime, oldTime);
    const getConversationByName = vi.fn();

    const actions = await sweepTranscriptRetention({
      transcriptDays: 2,
      agentsDir,
      deps: {
        sessionExists: vi.fn(async () => true),
        getConversationByName,
        log: vi.fn(),
      },
    });

    expect(existsSync(transcriptPath)).toBe(true);
    expect(getConversationByName).not.toHaveBeenCalled();
    expect(actions[0]).toContain('deleted 0 transcript files');
  });
});
