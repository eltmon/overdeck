/**
 * PAN-3286 WI-4: workspace-addressed `pan memory status` / `pan memory summary`
 * plus `--history N` archived-status recall. Covers all three addressing modes
 * (`--workspace <id|name>`, issue positional, cwd fallback), the unresolvable
 * error, history ordering/capping, and regression-locks the pre-existing
 * issue-positional output for both commands.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryIdentity, MemoryObservation, MemoryStatus } from '@overdeck/contracts';
import { memoryStatusCommand, memorySummaryCommand } from '../../../src/cli/commands/memory.js';
import { MEMORY_STATUS_HISTORY_LIMIT } from '../../../src/lib/memory/cli.js';
import { commitStatusRollup } from '../../../src/lib/memory/rollup.js';
import { writeObservation } from '../../../src/lib/memory/observations.js';
import { closeDatabase } from '../../../src/lib/database/index.js';
import { closeMemoryFtsDatabases } from '../../../src/lib/memory/fts-db.js';
import { createWorkspace, upsertProjectFromConfig } from '../../../src/lib/workspaces/writer.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../helpers/overdeck-test-db.js';

let odb: OverdeckTestDb;
let workspaceDir: string;
let unregisteredDir: string;
const originalCwd = process.cwd();

function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit unexpectedly called with ${code}`);
  }) as never);
}

function captureLog() {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  return () => logSpy.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
}

function captureError() {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  return () => errorSpy.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
}

function status(overrides: Partial<MemoryStatus> = {}): MemoryStatus {
  return {
    name: overrides.name ?? 'status-name',
    headline: overrides.headline ?? 'Current headline',
    summary: overrides.summary ?? 'Current summary body',
    goal: overrides.goal ?? 'Ship WI-4',
    phase: overrides.phase ?? 'building',
    accomplished: overrides.accomplished ?? [],
    decided: overrides.decided ?? [],
    open: overrides.open ?? [],
    nextSteps: overrides.nextSteps ?? ['write the test', 'run the test'],
    confidence: overrides.confidence ?? 0.8,
    workingSet: overrides.workingSet ?? [],
    tags: overrides.tags ?? [],
  };
}

function identityFor(projectId: string, workspaceId: string, issueId: string | null): MemoryIdentity {
  return {
    projectId,
    workspaceId,
    issueId,
    runId: 'run-1',
    sessionId: 'session-1',
    agentRole: 'work',
    agentHarness: 'claude-code',
  };
}

function observation(identity: MemoryIdentity, overrides: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id: overrides.id ?? 'obs-1',
    timestamp: overrides.timestamp ?? '2026-05-16T20:00:00.000Z',
    ...identity,
    gitBranch: 'main',
    sourceTranscriptOffset: 1,
    actionStatus: overrides.actionStatus ?? null,
    narrative: overrides.narrative ?? 'narrative',
    summary: overrides.summary ?? 'summary',
    files: overrides.files ?? [],
    tags: overrides.tags ?? [],
    tokens: { prompt: 1, completion: 1, total: 2 },
    model: 'stub-model',
  };
}

/** Seed a status through the real write door so archiving happens for real. */
async function seedStatus(
  projectId: string,
  workspaceId: string,
  issueId: string | null,
  value: MemoryStatus,
  now: Date,
): Promise<void> {
  await commitStatusRollup({
    identity: { projectId, workspaceId, issueId },
    status: value,
    pendingTurns: [],
    now,
    emitStatusUpdated: () => {},
  });
}

beforeEach(() => {
  odb = setupOverdeckTestDb();
  workspaceDir = mkdtempSync(join(tmpdir(), 'pan-3286-status-ws-'));
  unregisteredDir = mkdtempSync(join(tmpdir(), 'pan-3286-status-none-'));
});

afterEach(() => {
  process.chdir(originalCwd);
  closeMemoryFtsDatabases();
  closeDatabase();
  teardownOverdeckTestDb(odb);
  rmSync(workspaceDir, { recursive: true, force: true });
  rmSync(unregisteredDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('memoryStatusCommand addressing modes (PAN-3286 WI-4 FR-5)', () => {
  it('resolves --workspace by id and by name and prints the same status the issue positional prints', async () => {
    upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: '/repo/overdeck' });
    const workspaceId = await createWorkspace({
      projectId: 'overdeck',
      kind: 'issue',
      name: 'feature-pan-1',
      path: workspaceDir,
      issueId: 'PAN-1',
    });
    await seedStatus('overdeck', workspaceId, 'PAN-1', status({ headline: 'Shared headline' }), new Date('2026-07-01T00:00:00.000Z'));

    const exitSpy = mockExit();
    const byIssue = captureLog();
    await memoryStatusCommand('PAN-1', { project: 'overdeck' });
    const issueOutput = byIssue();
    vi.restoreAllMocks();

    mockExit();
    const byId = captureLog();
    await memoryStatusCommand(undefined, { workspace: workspaceId });
    const idOutput = byId();
    vi.restoreAllMocks();

    mockExit();
    const byName = captureLog();
    await memoryStatusCommand(undefined, { workspace: 'feature-pan-1' });
    const nameOutput = byName();

    expect(issueOutput).toContain('Shared headline');
    expect(idOutput).toEqual(issueOutput);
    expect(nameOutput).toEqual(issueOutput);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('falls back to the cwd workspace when neither a positional nor --workspace is given', async () => {
    upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: '/repo/overdeck' });
    const workspaceId = await createWorkspace({
      projectId: 'overdeck',
      kind: 'scratch',
      name: 'scratch-lens',
      path: workspaceDir,
    });
    await seedStatus('overdeck', workspaceId, null, status({ headline: 'Cwd-resolved headline' }), new Date('2026-07-01T00:00:00.000Z'));

    process.chdir(workspaceDir);
    const exitSpy = mockExit();
    const printed = captureLog();

    await memoryStatusCommand(undefined, {});

    expect(exitSpy).not.toHaveBeenCalled();
    expect(printed()).toContain('Cwd-resolved headline');
  });

  it('exits non-zero naming all three addressing modes when nothing resolves', async () => {
    process.chdir(unregisteredDir);
    const exitSpy = mockExit();
    const printedError = captureError();

    await expect(memoryStatusCommand(undefined, {})).rejects.toThrow(/process\.exit/);

    expect(exitSpy).toHaveBeenCalledWith(1);
    const message = printedError();
    expect(message).toContain('--workspace');
    expect(message).toContain('issue positional');
    expect(message).toContain('workspace directory');
  });
});

describe('memoryStatusCommand --history (PAN-3286 WI-4 FR-6)', () => {
  it('prints the current status then archived statuses newest-first', async () => {
    upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: '/repo/overdeck' });
    const workspaceId = await createWorkspace({
      projectId: 'overdeck',
      kind: 'scratch',
      name: 'history-lens',
      path: workspaceDir,
    });
    await seedStatus('overdeck', workspaceId, null, status({ headline: 'Oldest', phase: 'exploring' }), new Date('2026-07-01T00:00:00.000Z'));
    await seedStatus('overdeck', workspaceId, null, status({ headline: 'Middle', phase: 'planning' }), new Date('2026-07-02T00:00:00.000Z'));
    await seedStatus('overdeck', workspaceId, null, status({ headline: 'Newest', phase: 'building' }), new Date('2026-07-03T00:00:00.000Z'));

    const exitSpy = mockExit();
    const printed = captureLog();

    await memoryStatusCommand(undefined, { workspace: workspaceId, history: 2 });

    expect(exitSpy).not.toHaveBeenCalled();
    const output = printed();
    expect(output.indexOf('Newest')).toBeLessThan(output.indexOf('Middle'));
    expect(output.indexOf('Middle')).toBeLessThan(output.indexOf('Oldest'));
    expect(output).toContain('2026-07-02T00:00:00.000Z');
  });

  it('emits {current, history} for --history --json and caps the request at 50', async () => {
    upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: '/repo/overdeck' });
    const workspaceId = await createWorkspace({
      projectId: 'overdeck',
      kind: 'scratch',
      name: 'json-lens',
      path: workspaceDir,
    });
    await seedStatus('overdeck', workspaceId, null, status({ headline: 'Archived one' }), new Date('2026-07-01T00:00:00.000Z'));
    await seedStatus('overdeck', workspaceId, null, status({ headline: 'Live now' }), new Date('2026-07-02T00:00:00.000Z'));

    const exitSpy = mockExit();
    const printed = captureLog();

    await memoryStatusCommand(undefined, { workspace: workspaceId, history: 9999, json: true });

    expect(exitSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(printed()) as {
      current: MemoryStatus | null;
      history: Array<{ archivedAt: string | null; status: MemoryStatus }>;
    };
    expect(payload.current?.headline).toBe('Live now');
    expect(payload.history.map((entry) => entry.status.headline)).toEqual(['Archived one']);
    expect(payload.history.length).toBeLessThanOrEqual(MEMORY_STATUS_HISTORY_LIMIT);
    expect(payload.history[0]?.archivedAt).toBe('2026-07-02T00:00:00.000Z');
  });

  it('reports no retained archive when a workspace has only a current status', async () => {
    upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: '/repo/overdeck' });
    const workspaceId = await createWorkspace({
      projectId: 'overdeck',
      kind: 'scratch',
      name: 'fresh-lens',
      path: workspaceDir,
    });
    await seedStatus('overdeck', workspaceId, null, status(), new Date('2026-07-01T00:00:00.000Z'));

    mockExit();
    const printed = captureLog();

    await memoryStatusCommand(undefined, { workspace: workspaceId, history: 3 });

    expect(printed()).toContain('No archived statuses retained.');
  });
});

describe('issue-positional regression lock (PAN-3286 WI-4)', () => {
  it('pan memory status <issue> prints headline, summary, phase/confidence, and next steps unchanged', async () => {
    upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: '/repo/overdeck' });
    const workspaceId = await createWorkspace({
      projectId: 'overdeck',
      kind: 'issue',
      name: 'feature-pan-2',
      path: workspaceDir,
      issueId: 'PAN-2',
    });
    await seedStatus('overdeck', workspaceId, 'PAN-2', status(), new Date('2026-07-01T00:00:00.000Z'));

    mockExit();
    const printed = captureLog();

    await memoryStatusCommand('PAN-2', { project: 'overdeck' });

    expect(printed().split('\n')).toEqual([
      'Current headline',
      'Current summary body',
      'phase=building confidence=0.8',
      'Next: write the test; run the test',
    ]);
  });

  it('pan memory status <issue> with no status prints the unchanged not-found note', async () => {
    upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: '/repo/overdeck' });
    await createWorkspace({
      projectId: 'overdeck',
      kind: 'issue',
      name: 'feature-pan-3',
      path: workspaceDir,
      issueId: 'PAN-3',
    });

    mockExit();
    const printed = captureLog();

    await memoryStatusCommand('PAN-3', { project: 'overdeck' });

    expect(printed()).toBe('No memory status found for PAN-3.');
  });

  it('pan memory summary <issue> still writes an issue-titled summary from the issue workspace', async () => {
    upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: '/repo/overdeck' });
    const workspaceId = await createWorkspace({
      projectId: 'overdeck',
      kind: 'issue',
      name: 'feature-pan-4',
      path: workspaceDir,
      issueId: 'PAN-4',
    });
    for (const index of [1, 2, 3]) {
      await writeObservation(observation(identityFor('overdeck', workspaceId, 'PAN-4'), {
        id: `obs-${index}`,
        timestamp: `2026-05-16T2${index}:00:00.000Z`,
        summary: `observation ${index}`,
      }));
    }

    mockExit();
    const printed = captureLog();

    await memorySummaryCommand('PAN-4', { project: 'overdeck', date: '2026-05-16', json: true });

    const result = JSON.parse(printed()) as { status: string; markdown: string; observationCount: number };
    expect(result.status).toBe('generated');
    expect(result.observationCount).toBe(3);
    expect(result.markdown).toContain('# PAN-4 memory summary — 2026-05-16');
  });

  it('pan memory summary --workspace titles the summary with the workspace name for an issue-less workspace', async () => {
    upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: '/repo/overdeck' });
    const workspaceId = await createWorkspace({
      projectId: 'overdeck',
      kind: 'scratch',
      name: 'summary-lens',
      path: workspaceDir,
    });
    for (const index of [1, 2, 3]) {
      await writeObservation(observation(identityFor('overdeck', workspaceId, null), {
        id: `obs-ws-${index}`,
        timestamp: `2026-05-16T2${index}:00:00.000Z`,
        summary: `workspace observation ${index}`,
      }));
    }

    mockExit();
    const printed = captureLog();

    await memorySummaryCommand(undefined, { workspace: 'summary-lens', date: '2026-05-16', json: true });

    const result = JSON.parse(printed()) as { status: string; markdown: string };
    expect(result.status).toBe('generated');
    expect(result.markdown).toContain('# summary-lens memory summary — 2026-05-16');
  });
});
