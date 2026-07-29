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
const recordedWorkspaces = new Map<string, string | null>();
const recordedStartedAt = new Map<string, string>();
const PROJECT_ROOT = join(fakeHome, 'Projects', 'overdeck');

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => fakeHome };
});

// The two seams the resolver reads. Standing them up for real would drag in the
// whole two-door state stack, which this test says nothing about.
vi.mock('../../src/lib/agents/agent-state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/agents/agent-state.js')>();
  return {
    ...actual,
    getAgentStateSync: (id: string) => {
      const workspace = recordedWorkspaces.has(id) ? recordedWorkspaces.get(id) : WORKSPACE;
      return workspace
        ? { id, workspace, startedAt: recordedStartedAt.get(id) ?? '1970-01-01T00:00:00.000Z' }
        : null;
    },
  };
});

vi.mock('../../src/lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/projects.js')>();
  return {
    ...actual,
    resolveProjectFromIssueSync: () => ({ projectPath: PROJECT_ROOT }),
  };
});

vi.mock('../../src/lib/agents/activity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/agents/activity.js')>();
  return { ...actual, getLatestSessionIdSync: (id: string) => ownSessionIds.get(id) ?? null };
});

const WORKSPACE = '/home/eltmon/Projects/overdeck';
const OWN_SESSION = '5f5168f3-7e17-4aed-9fe2-2bbb622e4acd';
const OTHER_SESSION = 'ceba1402-1e09-436f-aa3d-6dd2b6a4c202';

const { getAgentJsonlPath, getAgentWorkspace, getClaudeProjectDir } = await import('../../src/lib/agent-enrichment.js');
const { detectPendingOperatorDecision } = await import('../../src/lib/agents/pending-decision-gate.js');
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

function writePendingAuqTranscript(sessionId: string, mtime: Date): void {
  const projectDir = getClaudeProjectDir(WORKSPACE);
  mkdirSync(projectDir, { recursive: true });
  const transcript = join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(transcript, JSON.stringify({
    timestamp: '2026-07-28T10:00:00.000Z',
    message: {
      content: [{
        type: 'tool_use',
        id: 'pending-auq',
        name: 'AskUserQuestion',
        input: {
          questions: [{
            question: 'Which recovery action?',
            header: 'Recovery',
            multiSelect: false,
            options: [{ label: 'Wait', description: 'leave the session running' }],
          }],
        },
      }],
    },
  }) + '\n');
  utimesSync(transcript, mtime, mtime);
}

beforeEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
  mkdirSync(fakeHome, { recursive: true });
  ownSessionIds.clear();
  recordedWorkspaces.clear();
  recordedStartedAt.clear();
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('getAgentWorkspace()', () => {
  it('derives the strike layout when recorded state and tmux are unavailable', async () => {
    const strikeWorkspace = join(PROJECT_ROOT, 'workspaces', 'feature-pan-2857-strike');
    mkdirSync(join(PROJECT_ROOT, 'workspaces', 'feature-pan-2857'), { recursive: true });
    mkdirSync(strikeWorkspace, { recursive: true });
    recordedWorkspaces.set('strike-pan-2857', null);

    const resolved = await Effect.runPromise(getAgentWorkspace('strike-pan-2857'));

    expect(resolved).toBe(strikeWorkspace);
  });
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

describe('forced fresh-session decision boundary', () => {
  it('does not recreate a discarded AUQ from the previous session generation', async () => {
    const agentId = 'agent-pan-3228';
    writePendingAuqTranscript(OTHER_SESSION, new Date('2026-07-28T10:00:01.000Z'));

    // --force wipes the old agent directory, so the replacement starts without
    // a pinned session id while the sacred historical JSONL remains on disk.
    recordedStartedAt.set(agentId, '2026-07-28T10:01:00.000Z');

    const pending = await detectPendingOperatorDecision(agentId, {
      sessionExists: async () => false,
    });

    expect(pending).toBeNull();
  });

  it('still reports an AUQ from the replacement session pinned to the agent', async () => {
    const agentId = 'agent-pan-3228';
    ownSessionIds.set(agentId, OWN_SESSION);
    recordedStartedAt.set(agentId, '2026-07-28T10:01:00.000Z');
    writePendingAuqTranscript(OWN_SESSION, new Date('2026-07-28T10:00:01.000Z'));

    const pending = await detectPendingOperatorDecision(agentId, {
      sessionExists: async () => false,
    });

    expect(pending).toEqual({
      source: 'jsonl-auq',
      reason: 'ask_user_question',
    });
  });
});
