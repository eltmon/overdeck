import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RETAINED_TRANSCRIPTS_MARKER } from '../../../../src/lib/agents/state-dir-removal.js';
import { sweepTranscriptRetention } from '../../../../src/lib/cloister/transcript-retention.js';
import { removeAgent } from '../../../../src/lib/agents/removal.js';
import { listAllAgentsSync } from '../../../../src/lib/overdeck/agents.js';
import {
  closeOverdeckDatabaseSync,
  getOverdeckDatabaseSync,
} from '../../../../src/lib/overdeck/infra.js';

const NOW = new Date('2026-07-31T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('canonical agent removal with retained transcripts', () => {
  const originalOverdeckHome = process.env.OVERDECK_HOME;
  let testHome: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    testHome = mkdtempSync(join(tmpdir(), 'agent-removal-'));
    process.env.OVERDECK_HOME = testHome;
    closeOverdeckDatabaseSync();
  });

  afterEach(() => {
    vi.useRealTimers();
    closeOverdeckDatabaseSync();
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
    rmSync(testHome, { recursive: true, force: true });
  });

  it('keeps a stopped linkage row until configured retention expires the nested JSONL', async () => {
    const agentId = 'agent-pan-3357-review-correctness';
    const agentsDir = join(testHome, 'agents');
    const agentDir = join(agentsDir, agentId);
    const transcriptPath = join(agentDir, 'sessions', 'review.jsonl');
    mkdirSync(join(agentDir, 'sessions'), { recursive: true });
    writeFileSync(transcriptPath, '{}\n');
    const oldTime = new Date(NOW.getTime() - 30 * DAY_MS);
    utimesSync(transcriptPath, oldTime, oldTime);
    const db = getOverdeckDatabaseSync();
    db.prepare(`
      INSERT INTO issues (id, stage, updated_at)
      VALUES (?, ?, ?)
    `).run('PAN-3357', 'working', Date.now());
    db.prepare(`
      INSERT INTO agents (id, issue_id, role, status, workspace, harness, model, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agentId,
      'PAN-3357',
      'review',
      'running',
      '/workspaces/feature-pan-3357',
      'claude-code',
      'claude',
      Date.now(),
    );

    const cleanup = await removeAgent(agentId);

    expect(cleanup.removedDir).toBe(false);
    expect(existsSync(transcriptPath)).toBe(true);
    expect(existsSync(join(agentDir, RETAINED_TRANSCRIPTS_MARKER))).toBe(true);
    expect(listAllAgentsSync()).toEqual([
      expect.objectContaining({ id: agentId, issueId: 'PAN-3357', status: 'stopped' }),
    ]);

    await sweepTranscriptRetention({
      transcriptDays: 2,
      agentsDir,
      deps: {
        listSessionNames: vi.fn(async () => []),
        listAgents: listAllAgentsSync,
        isTerminalAgent: vi.fn(() => true),
        listConversations: vi.fn(),
        listArchivedConversations: vi.fn(),
        now: () => Date.now(),
        log: vi.fn(),
      },
    });

    expect(existsSync(agentDir)).toBe(false);
    expect(listAllAgentsSync()).toEqual([]);
  });
});
