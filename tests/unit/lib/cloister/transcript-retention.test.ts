import type { Dirent, Stats } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  sweepTranscriptRetention,
  type TranscriptRetentionAgent,
  type TranscriptRetentionDeps,
} from '../../../../src/lib/cloister/transcript-retention.js';

/**
 * PAN-3917 NFR-4: the hourly sweep deletes a `.jsonl` transcript only when the
 * age threshold has passed AND the sweep can say the work landed — the agent is
 * stopped and the forge reports its pull request merged. Every other shape
 * (a retired directory nothing can vouch for, an unmerged PR, a forge read that
 * failed) must skip rather than delete: the gate fails closed.
 */

const AGENTS_DIR = '/agents';
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-19T12:00:00.000Z');

function dirent(name: string, kind: 'dir' | 'file'): Dirent {
  return {
    name,
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
  } as unknown as Dirent;
}

interface Fixture {
  /** path → entries. Files carry an mtime offset in days before now. */
  dirs: Record<string, Array<[name: string, kind: 'dir' | 'file']>>;
  fileAgeDays: Record<string, number>;
  agents?: TranscriptRetentionAgent[];
  isTerminalAgent?: (agent: TranscriptRetentionAgent) => Promise<boolean>;
}

function sweep(fixture: Fixture) {
  const removedFiles: string[] = [];
  const removedDirs: string[] = [];
  const deps: Partial<TranscriptRetentionDeps> = {
    readDir: async (path) => {
      const entries = fixture.dirs[path];
      if (!entries) {
        const error = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return entries.map(([name, kind]) => dirent(name, kind));
    },
    stat: async (path) => {
      const ageDays = fixture.fileAgeDays[path];
      if (ageDays === undefined) {
        const error = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return { mtimeMs: Date.now() - ageDays * DAY_MS } as Stats;
    },
    removeFile: async (path) => { removedFiles.push(path); },
    removeDir: async (path) => {
      removedDirs.push(path);
      const error = new Error(`ENOTEMPTY: ${path}`) as NodeJS.ErrnoException;
      error.code = 'ENOTEMPTY';
      throw error;
    },
    listSessionNames: async () => [],
    listAgents: () => fixture.agents ?? [],
    ...(fixture.isTerminalAgent ? { isTerminalAgent: fixture.isTerminalAgent } : {}),
    listConversations: () => [],
    listArchivedConversations: () => [],
    log: () => {},
  };
  return sweepTranscriptRetention({ transcriptDays: 30, agentsDir: AGENTS_DIR, deps })
    .then((actions) => ({ actions, removedFiles, removedDirs }));
}

const stoppedAgent: TranscriptRetentionAgent = {
  id: 'agent-pan-1',
  issueId: 'PAN-1',
  status: 'stopped',
  workspace: '/repo/workspaces/feature-pan-1',
};

const oldTranscriptFixture = {
  dirs: {
    [AGENTS_DIR]: [['agent-pan-1', 'dir'] as [string, 'dir']],
    [`${AGENTS_DIR}/agent-pan-1`]: [
      ['session.jsonl', 'file'] as [string, 'file'],
      ['.retained-transcripts', 'file'] as [string, 'file'],
    ],
  },
  fileAgeDays: {
    [`${AGENTS_DIR}/agent-pan-1/session.jsonl`]: 90,
    [`${AGENTS_DIR}/agent-pan-1/.retained-transcripts`]: 90,
  },
};

describe('sweepTranscriptRetention — the NFR-4 merged gate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deletes an expired transcript only when the forge says the PR merged', async () => {
    const { removedFiles } = await sweep({
      ...oldTranscriptFixture,
      agents: [stoppedAgent],
      isTerminalAgent: async () => true,
    });

    expect(removedFiles).toContain(`${AGENTS_DIR}/agent-pan-1/session.jsonl`);
  });

  it('keeps the transcript when the PR has not merged', async () => {
    const { removedFiles } = await sweep({
      ...oldTranscriptFixture,
      agents: [stoppedAgent],
      isTerminalAgent: async () => false,
    });

    expect(removedFiles).toEqual([]);
  });

  it('keeps the transcript when the merged state cannot be determined', async () => {
    const { removedFiles } = await sweep({
      ...oldTranscriptFixture,
      agents: [stoppedAgent],
      isTerminalAgent: async () => { throw new Error('gh pr view failed'); },
    });

    expect(removedFiles).toEqual([]);
  });

  it('keeps a retired directory no agent listing can vouch for, marker or not', async () => {
    // removeAgent leaves `.retained-transcripts` behind when transcripts
    // survived the state-dir cleanup. The marker says "this dir holds
    // transcripts" — it says nothing about whether the work merged, so it can
    // never be the eligibility fact on its own.
    const { removedFiles } = await sweep({ ...oldTranscriptFixture, agents: [] });

    expect(removedFiles).toEqual([]);
  });

  it('keeps a transcript younger than the retention window even when merged', async () => {
    const { removedFiles } = await sweep({
      dirs: oldTranscriptFixture.dirs,
      fileAgeDays: {
        [`${AGENTS_DIR}/agent-pan-1/session.jsonl`]: 3,
        [`${AGENTS_DIR}/agent-pan-1/.retained-transcripts`]: 3,
      },
      agents: [stoppedAgent],
      isTerminalAgent: async () => true,
    });

    expect(removedFiles).toEqual([]);
  });
});
