/**
 * PAN-1990 memory-backfill: `pan memory backfill` reads historical Claude
 * Code JSONL transcripts, maps each session's first-message cwd to a
 * registered workspace, and feeds matched sessions through the real
 * extraction pipeline (only the LLM-calling `extract` stage is faked — claim,
 * commit, and write are real, exactly like tests/lib/memory/e2e.test.ts).
 *
 * HAZARD H5: every fixture file here is read-only from backfill's
 * perspective — assertions confirm the fixture bytes are untouched.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeMemoryFtsDatabases } from '../fts-db.js';
import { createWorkspace, upsertProjectFromConfig } from '../../workspaces/writer.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../tests/helpers/overdeck-test-db.js';
import { backfillMemoryFromTranscripts } from '../backfill.js';

let odb: OverdeckTestDb;
let originalHome: string | undefined;
let fakeHome: string;
let claudeProjectsDir: string;
let workspacePath: string;
let workspaceId: string;

function sessionLine(sessionId: string, cwd: string): string {
  return `${JSON.stringify({
    sessionId,
    cwd,
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: 'hello from a backfilled session' }] },
  })}\n`;
}

function extractedStub() {
  return {
    status: 'extracted' as const,
    provider: 'stub',
    result: {
      data: {
        narrative: 'Backfilled narrative.',
        summary: 'Backfilled memory summary.',
        actionStatus: 'Backfilled',
        tags: ['backfill'],
        files: ['src/lib/memory/backfill.ts'],
      },
      usage: { input: 10, output: 5 },
      cost: { usd: 0.001 },
      model: 'stub-memory-model',
      provider: 'stub',
    },
  };
}

beforeEach(async () => {
  odb = setupOverdeckTestDb();
  originalHome = process.env.HOME;
  fakeHome = mkdtempSync(join(tmpdir(), 'pan-1990-backfill-home-'));
  process.env.HOME = fakeHome;
  claudeProjectsDir = join(fakeHome, '.claude', 'projects');
  mkdirSync(claudeProjectsDir, { recursive: true });

  upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: join(odb.home, 'overdeck') });
  workspacePath = join(odb.home, 'workspaces', 'feature-pan-9001');
  workspaceId = await createWorkspace({
    projectId: 'overdeck',
    kind: 'issue',
    name: 'feature-pan-9001',
    path: workspacePath,
    issueId: 'PAN-9001',
  });
});

afterEach(() => {
  closeMemoryFtsDatabases();
  teardownOverdeckTestDb(odb);
  rmSync(fakeHome, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

/** e2e.test.ts stubs these same two hooks — real event-store emission owns background timers unrelated to this test. */
const quietHooks = { emitObservationCreated: async () => undefined, updateHealth: async () => undefined };

function writeFixtureSession(dirName: string, sessionId: string, cwd: string): string {
  const dir = join(claudeProjectsDir, dirName);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, sessionLine(sessionId, cwd), 'utf8');
  return path;
}

describe('backfillMemoryFromTranscripts (ac1)', () => {
  it('a fixture session whose cwd matches a workspace produces a written observation', async () => {
    writeFixtureSession('matched-project', 'session-matched', workspacePath);

    const result = await backfillMemoryFromTranscripts({ extract: async () => extractedStub(), ...quietHooks });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ status: 'processed', workspaceId, sessionId: 'session-matched' });
    expect(result.sessions[0]!.extraction?.status).toBe('written');
  });
});

describe('backfillMemoryFromTranscripts (ac2)', () => {
  it('a fixture session whose cwd matches no workspace is skipped, producing no observation', async () => {
    writeFixtureSession('unmatched-project', 'session-unmatched', '/nowhere/this/matches');

    const result = await backfillMemoryFromTranscripts({ extract: async () => extractedStub() });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ status: 'skipped-unmatched-cwd', workspaceId: null });
    expect(result.sessions[0]!.extraction).toBeUndefined();
  });
});

describe('backfillMemoryFromTranscripts (ac3)', () => {
  it('a second run creates zero new observation rows for an already-processed session', async () => {
    writeFixtureSession('matched-project', 'session-repeat', workspacePath);

    const first = await backfillMemoryFromTranscripts({ extract: async () => extractedStub(), ...quietHooks });
    expect(first.sessions[0]!.extraction?.status).toBe('written');

    const second = await backfillMemoryFromTranscripts({ extract: async () => extractedStub(), ...quietHooks });
    expect(second.sessions[0]!.status).toBe('processed');
    expect(second.sessions[0]!.extraction?.status).not.toBe('written');
  });
});

describe('backfillMemoryFromTranscripts (ac4)', () => {
  it('--dry-run persists nothing and leaves the fixture JSONL byte-identical', async () => {
    const path = writeFixtureSession('matched-project', 'session-dry-run', workspacePath);
    const before = readFileSync(path);

    const result = await backfillMemoryFromTranscripts({ dryRun: true, extract: async () => extractedStub() });

    expect(result.sessions[0]).toMatchObject({ status: 'dry-run-matched', workspaceId });
    expect(readFileSync(path)).toEqual(before);

    const observationsDir = join(odb.home, 'memory', 'overdeck', workspaceId, 'observations');
    await expect(readdir(observationsDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
