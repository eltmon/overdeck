/**
 * Live Codex sessions whose newest turn failed on sign-in (PAN-5633 WI-4).
 *
 * A used or revoked refresh token is invisible in `~/.codex/auth.json`; the
 * proof is a failed turn, which Codex records in the session's rollout as
 * `task_complete.error` with `codex_error_info: "unauthorized"`. This module
 * reads the newest turn of every live Codex session and returns the auth
 * failures. It does not apply the healing rule (a failure older than the last
 * write of auth.json is healed): `activeCodexAuthFailures` in `codex-auth.ts`
 * does, so that rule lives in one place.
 *
 * Live = active Codex conversation rows (id = `tmuxSession`, the agent dir
 * name) plus running Codex agent states (id = `state.id`), capped at 64. A
 * Codex session is one whose harness `usesCodexHome`: its CODEX_HOME symlinks
 * auth.json to the shared native store, so one dead sign-in breaks them all. Each
 * rollout read is a fixed 128 KiB tail, so a 1 GB rollout costs the same as a
 * small one. Several dashboard tabs poll the status route, and the agent-state
 * listing reads every `state.json`, so one scan serves every caller for 15 s and
 * concurrent callers share one in-flight promise.
 */
import { listAgentStatesAsync } from '../agents/agent-state-read.js';
import { resolveCodexRolloutPath } from '../agents/transcript-resolver.js';
import { readCodexLastTurn, type CodexAuthFailure, type CodexLastTurn } from '../conversations/codex-thread-status.js';
import { listConversations } from '../overdeck/conversations.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';

export const CODEX_AUTH_SCAN_CACHE_MS = 15_000;
export const CODEX_AUTH_SCAN_MAX_SESSIONS = 64;

export interface CodexAuthFailureScanDeps {
  readonly listSessionIds?: () => Promise<readonly string[]>;
  readonly resolveRollout?: (id: string) => Promise<string | null>;
  readonly readLastTurn?: (path: string) => Promise<CodexLastTurn>;
  readonly now?: () => number;
}

/** Live Codex sessions: active codex conversations (tmuxSession) + running codex agents (id). */
export async function listLiveCodexSessionIds(): Promise<string[]> {
  const usesCodexHome = (harness: Parameters<typeof getHarnessBehavior>[0]) => getHarnessBehavior(harness).usesCodexHome;
  const conversations = listConversations()
    .filter((conv) => conv.status === 'active' && usesCodexHome(conv.harness))
    .map((conv) => conv.tmuxSession);
  const agents = (await listAgentStatesAsync({ skip: (name) => name.startsWith('conv-') || name.startsWith('ext-') }))
    .filter((state) => state.status === 'running' && usesCodexHome(state.harness))
    .map((state) => state.id);
  return [...conversations, ...agents];
}

async function scanOnce(deps: Required<Omit<CodexAuthFailureScanDeps, 'now'>>): Promise<CodexAuthFailure[]> {
  const ids = [...new Set(await deps.listSessionIds())].slice(0, CODEX_AUTH_SCAN_MAX_SESSIONS);
  const results = await Promise.all(ids.map(async (id): Promise<CodexAuthFailure | null> => {
    try {
      const path = await deps.resolveRollout(id);
      if (!path) return null;
      const { failure } = await deps.readLastTurn(path);
      return failure?.kind === 'auth' ? { id, at: failure.at, message: failure.message } : null;
    } catch {
      return null;
    }
  }));
  return results.filter((failure): failure is CodexAuthFailure => failure !== null);
}

/** A scanner with its own 15 s single-flight cache. A rejected scan is not cached. */
export function createCodexAuthFailureScanner(deps: CodexAuthFailureScanDeps = {}): () => Promise<readonly CodexAuthFailure[]> {
  const resolved = {
    listSessionIds: deps.listSessionIds ?? listLiveCodexSessionIds,
    resolveRollout: deps.resolveRollout ?? ((id: string) => resolveCodexRolloutPath(id)),
    readLastTurn: deps.readLastTurn ?? readCodexLastTurn,
  };
  const now = deps.now ?? Date.now;
  let cached: { startedAt: number; scan: Promise<readonly CodexAuthFailure[]> } | null = null;
  return () => {
    const startedAt = now();
    if (cached && startedAt - cached.startedAt < CODEX_AUTH_SCAN_CACHE_MS) return cached.scan;
    const scan = scanOnce(resolved);
    const entry = { startedAt, scan };
    cached = entry;
    scan.catch(() => { if (cached === entry) cached = null; });
    return scan;
  };
}

/** The process-wide scanner the routes and the spawn gate use. */
export const scanCodexAuthFailures: () => Promise<readonly CodexAuthFailure[]> = createCodexAuthFailureScanner();
