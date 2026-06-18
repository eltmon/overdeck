/**
 * Build gate G4 — sacred-file invariant (FR-6).
 *
 * Asserts that no production code path writes to an EXISTING conversation
 * transcript (Claude/pi/codex session JSONL) or modifies an existing memory
 * observation entry.
 *
 * Conversation side: verified statically — conversation-compaction.ts must
 * not call appendFile (the fork pattern replaced it with writeFile on a new
 * path). The runtime property (source JSONL unchanged after compaction) is
 * covered by services/__tests__/conversation-compaction.test.ts.
 *
 * Memory side: verified at runtime — MemoryFilesLive.appendObservation must
 * be idempotent: repeating the same observation ID does not add a second
 * entry to the JSONL file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../../../../..');

// ── Conversation transcripts — static guard ──────────────────────────────────

describe('sacred-file invariant — conversation transcripts (FR-6 static)', () => {
  it('conversation-compaction.ts must not call appendFile (fork pattern required)', () => {
    const src = readFileSync(
      join(ROOT, 'src/dashboard/server/services/conversation-compaction.ts'),
      'utf-8',
    );
    // appendFile mutates an existing file in place; the fork pattern writes only
    // to a NEW UUID-named file. If appendFile reappears here, the invariant is broken.
    expect(/\bappendFile\b/.test(src)).toBe(false);
  });
});

// ── Memory observations — runtime idempotency guard ──────────────────────────

describe('sacred-file invariant — memory observations (FR-6 runtime)', () => {
  let testHome: string;
  const savedOverdeckHome = process.env.OVERDECK_HOME;

  beforeEach(async () => {
    testHome = await mkdtemp(join(tmpdir(), 'pan-g4-sacred-'));
    process.env.OVERDECK_HOME = testHome;
  });

  afterEach(async () => {
    if (savedOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = savedOverdeckHome;
    await rm(testHome, { recursive: true, force: true });
  });

  it('appendObservation is idempotent — second write with same ID does not add a duplicate entry', async () => {
    const { MemoryFilesLive } = await import('../../../../src/lib/overdeck/memory.js');
    const { MemoryFiles } = await import('../../../../src/lib/overdeck/infra.js');

    // Minimal shape: appendObservation only accesses id, projectId, issueId, timestamp.
    const obs = {
      id: 'g4-test-obs',
      projectId: 'proj1',
      issueId: 'PAN-9999',
      timestamp: new Date().toISOString(),
    };

    const runAppend = (o: typeof obs) =>
      MemoryFiles.use((f) => f.appendObservation(o)).pipe(
        Effect.provide(MemoryFilesLive),
      );

    const { jsonlPath } = await Effect.runPromise(runAppend(obs));

    // Second write with same ID — must be a no-op (idempotent)
    await Effect.runPromise(runAppend(obs));

    const content = await readFile(jsonlPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ id: 'g4-test-obs' });
  });
});
