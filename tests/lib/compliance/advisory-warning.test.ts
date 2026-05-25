import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryIdentity, MemoryObservation } from '@panctl/contracts';
import {
  COMPLIANCE_ADVISORY_WARNING,
  readComplianceWarningMarkers,
  resolveComplianceAdvisoryWarning,
} from '../../../src/lib/compliance/advisory-warning.js';
import { ensureParentDir, resolveObservationsFile } from '../../../src/lib/memory/paths.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

const identity: MemoryIdentity = {
  projectId: 'panopticon-cli',
  workspaceId: 'feature-pan-1204',
  issueId: 'PAN-1204',
  runId: 'agent-pan-1204',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
};

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-compliance-warning-'));
  process.env.PANOPTICON_HOME = tempDir;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('compliance advisory warning', () => {
  it('returns a warning for the latest unmarked compliance miss in the current session', async () => {
    await writeObservations([
      observation({ id: 'other-session', sessionId: 'session-2', timestamp: '2026-05-24T10:00:00.000Z' }),
      observation({ id: 'miss-1', timestamp: '2026-05-24T10:01:00.000Z' }),
    ]);

    expect(await resolveComplianceAdvisoryWarning({ identity, loadComplianceMode: async () => 'advisory' })).toBe(COMPLIANCE_ADVISORY_WARNING);
    expect(await readComplianceWarningMarkers(identity.projectId, identity.issueId)).toEqual({
      warnedObservationIds: ['miss-1'],
    });
  });

  it('does not warn the same miss twice but warns for a later distinct miss', async () => {
    await writeObservations([
      observation({ id: 'miss-1', timestamp: '2026-05-24T10:01:00.000Z' }),
    ]);

    expect(await resolveComplianceAdvisoryWarning({ identity, loadComplianceMode: async () => 'enforcing' })).toBe(COMPLIANCE_ADVISORY_WARNING);
    expect(await resolveComplianceAdvisoryWarning({ identity, loadComplianceMode: async () => 'enforcing' })).toBeNull();

    await writeObservations([
      observation({ id: 'miss-1', timestamp: '2026-05-24T10:01:00.000Z' }),
      observation({ id: 'miss-2', timestamp: '2026-05-24T10:02:00.000Z' }),
    ]);

    expect(await resolveComplianceAdvisoryWarning({ identity, loadComplianceMode: async () => 'enforcing' })).toBe(COMPLIANCE_ADVISORY_WARNING);
    expect(await readComplianceWarningMarkers(identity.projectId, identity.issueId)).toEqual({
      warnedObservationIds: ['miss-1', 'miss-2'],
    });
  });

  it('suppresses warnings when compliance mode is off', async () => {
    await writeObservations([
      observation({ id: 'miss-1', timestamp: '2026-05-24T10:01:00.000Z' }),
    ]);

    expect(await resolveComplianceAdvisoryWarning({ identity, loadComplianceMode: async () => 'off' })).toBeNull();
    expect(await readComplianceWarningMarkers(identity.projectId, identity.issueId)).toEqual({ warnedObservationIds: [] });
  });

  it('ignores unrelated observations', async () => {
    await writeObservations([
      observation({ id: 'not-a-miss', actionStatus: 'working', tags: ['memory'] }),
    ]);

    expect(await resolveComplianceAdvisoryWarning({ identity, loadComplianceMode: async () => 'advisory' })).toBeNull();
  });
});

async function writeObservations(observations: MemoryObservation[]) {
  const path = resolveObservationsFile(identity.projectId, identity.issueId, '2026-05-24T00:00:00.000Z');
  await ensureParentDir(path);
  await writeFile(path, `${observations.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
}

function observation(overrides: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id: overrides.id ?? 'miss-1',
    timestamp: overrides.timestamp ?? '2026-05-24T10:01:00.000Z',
    projectId: identity.projectId,
    workspaceId: identity.workspaceId,
    issueId: identity.issueId,
    runId: identity.runId,
    sessionId: overrides.sessionId ?? identity.sessionId,
    agentRole: identity.agentRole,
    agentHarness: identity.agentHarness,
    gitBranch: 'feature/pan-1204',
    sourceTranscriptOffset: 0,
    actionStatus: overrides.actionStatus ?? 'compliance.miss',
    narrative: overrides.narrative ?? JSON.stringify({ triggerPhrases: ['we decided'], firstToolCall: 'Read' }),
    summary: overrides.summary ?? 'Compliance miss recorded for memory-first trigger.',
    files: overrides.files ?? [],
    tags: overrides.tags ?? ['compliance', 'miss'],
    tokens: overrides.tokens ?? { prompt: 1, completion: 1, total: 2 },
    model: overrides.model ?? 'test-model',
  };
}
