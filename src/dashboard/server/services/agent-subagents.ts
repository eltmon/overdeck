/**
 * In-harness subagents of a native agent (PAN-3920 W2).
 *
 * Conversations already list their Claude `Agent`/`Task` subagents and Codex
 * child threads (docs/CONVERSATION-SUBAGENTS.md). This module answers the same
 * question for an Overdeck agent (work, review, plan, …): resolve the agent's
 * own transcript through the session index, then read its subagents beside it.
 * Read-only; async fs only.
 */
import { stat } from 'node:fs/promises';
import type { SubagentSummary } from '@overdeck/contracts';

import {
  resolveAgentTranscriptCandidate,
  type ResolveJsonlPathOptions,
} from '../../../lib/agents/transcript-resolver.js';
import { readTranscriptModel } from '../../../lib/conversations/transcript-model.js';
import { listSubagentMetas, subagentTranscriptPath } from './conversation/subagents.js';
import { listCodexSubagentThreads, resolveCodexSubagentTranscript } from './conversation/codex-subagents.js';

/** A Claude subagent whose transcript changed this recently is still working (D3). */
export const SUBAGENT_WORKING_MTIME_MS = 120_000;

const SAFE_SUBAGENT_ID = /^[A-Za-z0-9_-]+$/;

export interface AgentSubagent extends SubagentSummary {
  readonly transcriptPath: string;
  readonly mtimeMs: number | null;
  /** The model the subagent's transcript last named; null when none is recorded. */
  readonly model: string | null;
}

export interface AgentSubagentOptions {
  readonly now?: () => number;
  readonly resolveOptions?: ResolveJsonlPathOptions;
}

async function mtimeOf(path: string): Promise<number | null> {
  return stat(path).then((value) => value.mtimeMs, () => null);
}

/** True for a subagent id that is safe to join into a transcript path. */
export function isSafeSubagentId(id: string): boolean {
  return SAFE_SUBAGENT_ID.test(id);
}

/**
 * Every subagent a parent transcript spawned: Claude `subagents/agent-*.jsonl`
 * beside the session file, or Codex child threads of the rollout. Other
 * transcript kinds have no subagents and answer `[]`.
 */
export async function listTranscriptSubagents(
  parent: { readonly kind: string; readonly path: string },
  now: number = Date.now(),
): Promise<AgentSubagent[]> {
  if (parent.kind === 'claude') {
    const subagents: AgentSubagent[] = [];
    for (const meta of await listSubagentMetas(parent.path)) {
      const transcriptPath = subagentTranscriptPath(parent.path, meta.agentId);
      if (!transcriptPath) continue;
      const mtimeMs = await mtimeOf(transcriptPath);
      const working = mtimeMs !== null && now - mtimeMs <= SUBAGENT_WORKING_MTIME_MS;
      const model = await readTranscriptModel(transcriptPath, mtimeMs);
      subagents.push({ ...meta, status: working ? 'running' : 'done', transcriptPath, mtimeMs, model });
    }
    return subagents;
  }

  if (parent.kind === 'codex') {
    // One walk of the sessions tree for every child; state comes from mtime (D3).
    const subagents: AgentSubagent[] = [];
    for (const { file, ...thread } of await listCodexSubagentThreads(parent.path)) {
      const mtimeMs = await mtimeOf(file);
      const working = mtimeMs !== null && now - mtimeMs <= SUBAGENT_WORKING_MTIME_MS;
      const model = await readTranscriptModel(file, mtimeMs);
      subagents.push({ ...thread, status: working ? 'running' : 'done', transcriptPath: file, mtimeMs, model });
    }
    return subagents;
  }

  return [];
}

/** Every subagent the agent's current transcript spawned; `[]` for harnesses without subagents. */
export async function listAgentSubagents(
  agentId: string,
  workspace: string,
  options: AgentSubagentOptions = {},
): Promise<AgentSubagent[]> {
  const parent = await resolveAgentTranscriptCandidate(agentId, workspace, options.resolveOptions);
  if (!parent) return [];
  return listTranscriptSubagents(parent, (options.now ?? Date.now)());
}

/** The transcript of one subagent of an agent, or null when it is not that agent's subagent. */
export async function resolveAgentSubagentTranscript(
  agentId: string,
  workspace: string,
  subagentId: string,
  options: AgentSubagentOptions = {},
): Promise<{ kind: 'claude' | 'codex'; path: string } | null> {
  if (!isSafeSubagentId(subagentId)) return null;
  const parent = await resolveAgentTranscriptCandidate(agentId, workspace, options.resolveOptions);
  if (!parent) return null;

  if (parent.kind === 'claude') {
    const path = subagentTranscriptPath(parent.path, subagentId);
    if (!path || await mtimeOf(path) === null) return null;
    return { kind: 'claude', path };
  }
  if (parent.kind === 'codex') {
    const path = await resolveCodexSubagentTranscript(parent.path, subagentId);
    return path ? { kind: 'codex', path } : null;
  }
  return null;
}
