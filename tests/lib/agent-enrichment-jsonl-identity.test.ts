/**
 * getAgentJsonlPath() must resolve the transcript belonging to THIS agent.
 *
 * A Claude project dir is keyed on cwd, so every session that ever ran in the
 * same cwd shares one directory. Agents whose cwd is the primary repo — the
 * flywheel orchestrator, conversations, `--cwd <repo>` handoffs — sit alongside
 * each other's transcripts there. The old "freshest .jsonl wins" resolution
 * therefore attributed whichever session wrote last to whoever asked: the live
 * flywheel was observed reporting an operator conversation's open
 * AskUserQuestion as its own pending question, so the Decisions list named the
 * wrong subject and answering it would have routed nowhere.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Created before the imports below: modules read homedir() at load time.
const fakeHome = mkdtempSync(join(tmpdir(), 'pan-jsonl-identity-'));

/** Agent id → its own pinned session id, as `session.id` on disk would report. */
const ownSessionIds = new Map<string, string>();

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => fakeHome };
});

// The two seams the resolver reads. Standing them up for real would drag in the
// whole two-door state stack, which this test says nothing about.
vi.mock('../../src/lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/agents.js')>();
  return { ...actual, getAgentStateSync: (id: string) => ({ id, workspace: WORKSPACE }) };
});

vi.mock('../../src/lib/agents/activity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/agents/activity.js')>();
  return { ...actual, getLatestSessionIdSync: (id: string) => ownSessionIds.get(id) ?? null };
});

const WORKSPACE = '/home/eltmon/Projects/overdeck';
const OWN_SESSION = '5f5168f3-7e17-4aed-9fe2-2bbb622e4acd';
const OTHER_SESSION = 'ceba1402-1e09-436f-aa3d-6dd2b6a4c202';

const { getAgentJsonlPath, getClaudeProjectDir } = await import('../../src/lib/agent-enrichment.js');
const { Effect } = await import('effect');

/** Populate the shared project dir; `newest` gets the latest mtime. */
function writeTranscripts(newest: string, ...others: string[]): string {
  const projectDir = getClaudeProjectDir(WORKSPACE);
  mkdirSync(projectDir, { recursive: true });
  for (const id of [...others, newest]) writeFileSync(join(projectDir, `${id}.jsonl`), '{}\n');
  const past = new Date(Date.now() - 60_000);
  for (const id of others) utimesSync(join(projectDir, `${id}.jsonl`), past, past);
  return projectDir;
}

beforeEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
  mkdirSync(fakeHome, { recursive: true });
  ownSessionIds.clear();
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('getAgentJsonlPath()', () => {
  it('reads its own transcript, not the freshest one in a shared project dir', async () => {
    ownSessionIds.set('flywheel-orchestrator', OWN_SESSION);
    const projectDir = writeTranscripts(OTHER_SESSION, OWN_SESSION);

    const resolved = await Effect.runPromise(getAgentJsonlPath('flywheel-orchestrator'));

    expect(resolved).toBe(join(projectDir, `${OWN_SESSION}.jsonl`));
  });

  it('falls back to the freshest transcript when the agent has no session id of its own', async () => {
    // codex and omp keep history elsewhere and pin no claude-code session id
    // here, so freshest-wins stays their only signal.
    const projectDir = writeTranscripts(OTHER_SESSION, OWN_SESSION);

    const resolved = await Effect.runPromise(getAgentJsonlPath('agent-pan-2765'));

    expect(resolved).toBe(join(projectDir, `${OTHER_SESSION}.jsonl`));
  });

  it('falls back to the freshest transcript when its own session id has no file on disk', async () => {
    ownSessionIds.set('conv-20260716-6155', 'never-written-to-disk');
    const projectDir = writeTranscripts(OTHER_SESSION);

    const resolved = await Effect.runPromise(getAgentJsonlPath('conv-20260716-6155'));

    expect(resolved).toBe(join(projectDir, `${OTHER_SESSION}.jsonl`));
  });
});
