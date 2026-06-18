import { appendFile, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryIdentity, MemoryObservation } from '@overdeck/contracts';

import { getComplianceStatus } from '../../../src/lib/compliance/status.js';
import { closeDatabase } from '../../../src/lib/database/index.js';
import { closeMemoryFtsDatabases } from '../../../src/lib/memory/fts-db.js';
import { ensureDir, resolveObservationsFile } from '../../../src/lib/memory/paths.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

const identity: MemoryIdentity = {
  projectId: 'panopticon-cli',
  workspaceId: 'feature-pan-1204',
  issueId: 'PAN-1204',
  runId: 'run-1',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
};

beforeEach(async () => {
  originalHome = process.env.OVERDECK_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-compliance-status-'));
  process.env.OVERDECK_HOME = tempDir;
});

afterEach(async () => {
  closeMemoryFtsDatabases();
  closeDatabase();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function observation(overrides: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id: overrides.id ?? 'obs-1',
    timestamp: overrides.timestamp ?? '2026-05-25T10:00:00.000Z',
    ...identity,
    issueId: overrides.issueId ?? identity.issueId,
    workspaceId: overrides.workspaceId ?? identity.workspaceId,
    sessionId: overrides.sessionId ?? identity.sessionId,
    gitBranch: 'feature/pan-1204',
    sourceTranscriptOffset: 1,
    actionStatus: overrides.actionStatus ?? 'compliance.miss',
    narrative: overrides.narrative ?? 'compliance.miss: memory search was not first.',
    summary: overrides.summary ?? 'compliance.miss',
    files: overrides.files ?? [],
    tags: overrides.tags ?? ['compliance.miss'],
    tokens: { prompt: 1, completion: 1, total: 2 },
    model: 'stub-model',
  };
}

async function writeObservationRecord(item: MemoryObservation): Promise<void> {
  const path = resolveObservationsFile(item.projectId, item.issueId, item.timestamp);
  await ensureDir(join(tempDir!, 'memory', item.projectId, item.issueId, 'observations'));
  await appendFile(path, `${JSON.stringify(item)}\n`, 'utf8');
}

async function writeConfig(content: string): Promise<string> {
  const path = join(tempDir!, 'config.yaml');
  await writeFile(path, content, 'utf8');
  return path;
}

describe('compliance status', () => {
  it('defaults to advisory mode when compliance config is absent', async () => {
    await expect(getComplianceStatus({ now: new Date('2026-05-25T12:00:00.000Z') }))
      .resolves.toMatchObject({ mode: 'advisory', recentMissCount: 0 });
  });

  it('reports off mode from compliance.mode config', async () => {
    const configPath = await writeConfig('compliance:\n  mode: off\n');

    await expect(getComplianceStatus({ configPath, now: new Date('2026-05-25T12:00:00.000Z') }))
      .resolves.toMatchObject({ mode: 'off', recentMissCount: 0 });
  });

  it('counts recent compliance misses with workspace, issue, and session filters', async () => {
    await writeObservationRecord(observation({ id: 'matching' }));
    await writeObservationRecord(observation({ id: 'other-session', sessionId: 'session-2' }));
    await writeObservationRecord(observation({ id: 'too-old', timestamp: '2026-05-23T10:00:00.000Z' }));
    await writeObservationRecord(observation({ id: 'other-issue', issueId: 'PAN-999', workspaceId: 'feature-pan-999' }));

    const status = await getComplianceStatus({
      workspace: 'feature-pan-1204',
      issue: 'PAN-1204',
      session: 'session-1',
      now: new Date('2026-05-25T12:00:00.000Z'),
    });

    expect(status).toMatchObject({
      mode: 'advisory',
      recentMissCount: 1,
      projectId: 'panopticon-cli',
      workspaceId: 'feature-pan-1204',
      issueId: 'PAN-1204',
      sessionId: 'session-1',
    });
  });
});
