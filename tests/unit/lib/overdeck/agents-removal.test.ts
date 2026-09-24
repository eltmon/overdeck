import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RETAINED_TRANSCRIPTS_MARKER } from '../../../../src/lib/agents/state-dir-removal.js';
import { sweepTranscriptRetention } from '../../../../src/lib/cloister/transcript-retention.js';
import { removeAgent } from '../../../../src/lib/agents/removal.js';
import { listAgentStatesSync } from '../../../../src/lib/agents/agent-state.js';

// paths.ts resolves AGENTS_DIR once at module load, so the home has to be
// pointed at a scratch directory before the subject's imports are evaluated.
const testHome = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join: joinPath } = require('node:path') as typeof import('node:path');
  const home = mkdtempSync(joinPath(tmpdir(), 'agent-removal-'));
  process.env.OVERDECK_HOME = home;
  return home;
});

const NOW = new Date('2026-07-31T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * PAN-3917: transcript linkage used to be a stopped tombstone row in
 * overdeck.db. The row is gone — the state directory plus its
 * retained-transcripts marker carries the linkage on its own — so these cases
 * assert the on-disk facts the sweep actually reads.
 */
describe('canonical agent removal with retained transcripts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    rmSync(join(testHome, 'agents'), { recursive: true, force: true });
    mkdirSync(join(testHome, 'agents'), { recursive: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(join(testHome, 'agents'), { recursive: true, force: true });
  });

  function seedAgent(agentId: string, issueId: string, extra: Record<string, unknown> = {}): string {
    const agentDir = join(testHome, 'agents', agentId);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({
      id: agentId,
      issueId,
      role: 'review',
      status: 'running',
      workspace: `/workspaces/feature-${issueId.toLowerCase()}`,
      harness: 'claude-code',
      model: 'claude',
      startedAt: NOW.toISOString(),
      ...extra,
    }));
    return agentDir;
  }

  function seedAgedTranscript(agentDir: string, name = 'review.jsonl'): string {
    const transcriptPath = join(agentDir, 'codex-home', 'sessions', '2026', '07', '01', name);
    mkdirSync(join(transcriptPath, '..'), { recursive: true });
    writeFileSync(transcriptPath, '{}\n');
    const oldTime = new Date(NOW.getTime() - 30 * DAY_MS);
    utimesSync(transcriptPath, oldTime, oldTime);
    return transcriptPath;
  }

  function sweep(agentsDir: string): Promise<string[]> {
    return sweepTranscriptRetention({
      transcriptDays: 2,
      agentsDir,
      deps: {
        listLiveAgentIds: vi.fn(async () => new Set()),
        listConversations: vi.fn(() => []),
        listArchivedConversations: vi.fn(() => []),
        now: () => Date.now(),
        log: vi.fn(),
      },
    });
  }

  it('retains the transcript during explicit removal until configured retention expires it', async () => {
    const agentId = 'agent-pan-3357-review-correctness';
    const agentsDir = join(testHome, 'agents');
    const agentDir = seedAgent(agentId, 'PAN-3357');
    const transcriptPath = seedAgedTranscript(agentDir);

    const cleanup = await removeAgent(agentId);

    // The nested transcript blocks the directory removal, so the marker stands
    // in for the tombstone row: the directory is retained, not live.
    expect(cleanup.removedDir).toBe(false);
    expect(existsSync(transcriptPath)).toBe(true);
    expect(existsSync(join(agentDir, RETAINED_TRANSCRIPTS_MARKER))).toBe(true);

    await sweep(agentsDir);

    expect(existsSync(agentDir)).toBe(false);
    expect(existsSync(transcriptPath)).toBe(false);
    expect(listAgentStatesSync()).toEqual([]);
  });

  it('expires an aged transcript the listing CAN vouch for', async () => {
    const agentId = 'agent-pan-3357-review-landed';
    const agentsDir = join(testHome, 'agents');
    const agentDir = seedAgent(agentId, 'PAN-3357', { status: 'stopped' });
    const transcriptPath = seedAgedTranscript(agentDir);

    await sweep(agentsDir);

    // Retention enumerates durable agent directories directly and owns final
    // deletion once their newest retained artifact has expired.
    expect(existsSync(transcriptPath)).toBe(false);
    expect(existsSync(agentDir)).toBe(false);
  });

  it('retires the runtime residue but never the session transcript (PAN-3479)', async () => {
    const agentId = 'agent-pan-3479-slot-1';
    const agentDir = seedAgent(agentId, 'PAN-3479', { sessionId: 'sess-3479' });
    const transcriptPath = seedAgedTranscript(agentDir, 'slot.jsonl');

    const cleanup = await removeAgent(agentId);

    // state.json is the runtime residue and goes; the JSONL under sessions/ is
    // the transcript linkage and stays, marked so no reader treats it as live.
    expect(cleanup.removedDir).toBe(false);
    expect(existsSync(join(agentDir, 'state.json'))).toBe(false);
    expect(existsSync(transcriptPath)).toBe(true);
    expect(existsSync(join(agentDir, RETAINED_TRANSCRIPTS_MARKER))).toBe(true);
    expect(listAgentStatesSync()).toEqual([]);
  });

  it('removes the directory outright when no transcript survives it', async () => {
    const agentId = 'agent-pan-3917-review-security';
    const agentDir = seedAgent(agentId, 'PAN-3917');

    const cleanup = await removeAgent(agentId);

    expect(cleanup.removedDir).toBe(true);
    expect(existsSync(agentDir)).toBe(false);
    expect(listAgentStatesSync()).toEqual([]);
  });
});
