import { writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryIdentity, MemoryObservation } from '@overdeck/contracts';

import { getComplianceStatus } from '../../../src/lib/compliance/status.js';
import { closeDatabase } from '../../../src/lib/database/index.js';
import { closeMemoryFtsDatabases } from '../../../src/lib/memory/fts-db.js';
import { writeObservation } from '../../../src/lib/memory/observations.js';
import { createWorkspace, upsertProjectFromConfig } from '../../../src/lib/workspaces/writer.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../helpers/overdeck-test-db.js';

let odb: OverdeckTestDb;
let identity: MemoryIdentity;

beforeEach(async () => {
  odb = setupOverdeckTestDb();
  upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: join(odb.home, 'overdeck') });
  const workspaceId = await createWorkspace({
    projectId: 'overdeck',
    kind: 'issue',
    name: 'feature-pan-1204',
    path: join(odb.home, 'workspaces', 'feature-pan-1204'),
    issueId: 'PAN-1204',
  });
  identity = {
    projectId: 'overdeck',
    workspaceId,
    issueId: 'PAN-1204',
    runId: 'run-1',
    sessionId: 'session-1',
    agentRole: 'work',
    agentHarness: 'claude-code',
  };
});

afterEach(() => {
  closeMemoryFtsDatabases();
  closeDatabase();
  teardownOverdeckTestDb(odb);
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

// PAN-1990 FR-9 review fix: searchMemory now queries the memory_fts index
// (see cli.ts), which only a real observation write populates — a raw JSONL
// append (the pre-fix version of this helper) is invisible to it.
async function writeObservationRecord(item: MemoryObservation): Promise<void> {
  await writeObservation(item);
}

async function writeConfig(content: string): Promise<string> {
  const path = join(odb.home, 'config.yaml');
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
      workspace: identity.workspaceId,
      issue: 'PAN-1204',
      session: 'session-1',
      now: new Date('2026-05-25T12:00:00.000Z'),
    });

    expect(status).toMatchObject({
      mode: 'advisory',
      recentMissCount: 1,
      projectId: 'overdeck',
      workspaceId: identity.workspaceId,
      issueId: 'PAN-1204',
      sessionId: 'session-1',
    });
  });
});
