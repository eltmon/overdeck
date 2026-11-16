/**
 * Live sessions and the shutdown preview (PAN-5342, WI-5, WI-6, WI-8).
 *
 * `listLiveSessionIds` is the one session census the drain, its verification,
 * the preview and the reboot guard share: the Set union of the terminal-backend
 * agent inventory and the conversation liveness door. On Herdr the agent
 * inventory already lists every `conv-*` pane, so the union counts each once;
 * the conversation list adds the managed tmux server's sessions, which covers a
 * legacy agent still running in `tmux -L overdeck` on a Herdr host. `null`
 * (either source unreadable) means indeterminate, never "nothing is running".
 *
 * `describeSession` labels a session for the banner and the record, and
 * `stopAgentAsOperator`/`stopConversationByName` are the drain's stop doors
 * (D-9): agents with cause `operator`, conversations through
 * `handleConversationStop`. Heavy graphs load lazily.
 *
 * `getShutdownPreview` answers GET /api/shutdown/preview: what a shutdown
 * would stop right now.
 */
import type { ShutdownWriter } from '@overdeck/contracts';
import { Effect } from 'effect';

import { getAgentState } from '../../../../lib/agents/agent-state-read.js';
import { isSessionAtTurnBoundary } from '../../../../lib/agents/liveness.js';
import { listLiveConversationSessions } from '../../../../lib/overdeck/conversation-liveness.js';
import { readRestartLockHolder } from '../../../../lib/restart-lock.js';
import { listLiveAgentIds } from '../../../../lib/terminal-backends/inventory.js';
import { listWriters } from './writers.js';

export interface LiveSessionSources {
  readonly listLiveAgentIds: () => Promise<ReadonlySet<string> | null>;
  readonly listLiveConversationSessions: () => Promise<ReadonlySet<string> | null>;
}

export async function listLiveSessionIds(sources: Partial<LiveSessionSources> = {}): Promise<ReadonlySet<string> | null> {
  const [agents, conversations] = await Promise.all([
    (sources.listLiveAgentIds ?? listLiveAgentIds)().catch(() => null),
    (sources.listLiveConversationSessions ?? (() => listLiveConversationSessions()))().catch(() => null),
  ]);
  if (agents === null || conversations === null) return null;
  return new Set([...agents, ...conversations]);
}

export interface ShutdownPreview {
  agents: number;
  conversations: number;
  workingNow: number;
  writers: ShutdownWriter[];
  restartInProgress: { pid: number } | null;
}

export interface PreviewDeps {
  readonly listLiveSessionIds: () => Promise<ReadonlySet<string> | null>;
  readonly atTurnBoundary: (id: string) => boolean;
  readonly listWriters: () => Promise<ShutdownWriter[]>;
  readonly readRestartLockHolder: () => Promise<{ pid: number } | null>;
}

const defaultPreviewDeps: PreviewDeps = {
  listLiveSessionIds: () => listLiveSessionIds(),
  atTurnBoundary: isSessionAtTurnBoundary,
  listWriters: () => listWriters(),
  readRestartLockHolder,
};

/** An unreadable inventory previews as zero sessions. */
export async function getShutdownPreview(overrides: Partial<PreviewDeps> = {}): Promise<ShutdownPreview> {
  const deps = { ...defaultPreviewDeps, ...overrides };
  const [live, writers, holder] = await Promise.all([
    deps.listLiveSessionIds(),
    deps.listWriters(),
    deps.readRestartLockHolder().catch(() => null),
  ]);
  const ids = [...(live ?? [])];
  const conversations = ids.filter((id) => id.startsWith('conv-')).length;
  return {
    agents: ids.length - conversations,
    conversations,
    workingNow: ids.filter((id) => !deps.atTurnBoundary(id)).length,
    writers,
    restartInProgress: holder ? { pid: holder.pid } : null,
  };
}

export type SessionInfo =
  | { kind: 'agent'; label: string; issueId?: string }
  | { kind: 'conversation'; label: string; conversationName: string; issueId?: string };

/** `conv-*` ids with a conversation row are conversations; every other id is an agent. */
export async function describeSession(id: string): Promise<SessionInfo> {
  if (id.startsWith('conv-')) {
    const { getConversationByTmuxSession } = await import('../../../../lib/overdeck/conversations.js');
    const row = getConversationByTmuxSession(id);
    if (row) {
      return {
        kind: 'conversation',
        label: row.title || row.name,
        conversationName: row.name,
        ...(row.issueId ? { issueId: row.issueId } : {}),
      };
    }
  }
  const state = getAgentState(id);
  if (!state) return { kind: 'agent', label: id };
  return { kind: 'agent', label: `${state.issueId} ${state.role} agent`, ...(state.issueId ? { issueId: state.issueId } : {}) };
}

export async function stopAgentAsOperator(id: string): Promise<void> {
  const { stopAgent } = await import('../../../../lib/agents/termination.js');
  await Effect.runPromise(stopAgent(id, 'operator'));
}

export async function stopConversationByName(name: string): Promise<void> {
  const { handleConversationStop } = await import('../../../../lib/overdeck/conversation-runtime.js');
  await handleConversationStop(name, {
    resolveSessionFileForCleanup: (c) => (c as { sessionFile?: string | null }).sessionFile ?? null,
  });
}
