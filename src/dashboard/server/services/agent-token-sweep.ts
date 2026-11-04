/**
 * PAN-4927 W-TOK1 (D-9, D-10): the agent-token sweep of the primary
 * dashboard. A crash, a lost `exited` event, or a fire-and-forget revoke cut
 * off by process exit can leave an agent MCP token active after its owner is
 * gone; one run revokes it. The run also prunes agent-token records revoked
 * more than 7 days ago.
 *
 * Owners are probed one at a time. An agent is dead only when the liveness
 * oracle confirms it (`isConfirmedDead`), and only after a grace period, so a
 * token minted for an agent whose pane does not exist yet survives. A token
 * whose agent state is missing is revoked only after the same grace, because
 * planning launches mint before their first state save (PAN-4932 D-9). A
 * conversation is ended by its row: missing, archived, or ended.
 *
 * The first run is `AGENT_TOKEN_SWEEP_FIRST_MS` after start, then one
 * `AGENT_TOKEN_SWEEP_INTERVAL_MS` after each run ends, so runs never overlap.
 */
import { listAccessTokens, pruneEndedAccessTokens, type PublicAccessTokenRecord } from '../../../lib/access-tokens.js';
import { getAgentState } from '../../../lib/agents/agent-state-read.js';
import { isAlive, isConfirmedDead } from '../../../lib/agents/liveness.js';
import { revokeAgentMcpTokens } from '../../../lib/mcp/agent-token.js';
import { conversationStateDir } from '../../../lib/overdeck/conversation-pane-role.js';
import { getConversationByName } from '../../../lib/overdeck/conversations.js';

export const AGENT_TOKEN_SWEEP_FIRST_MS = 60_000;
export const AGENT_TOKEN_SWEEP_INTERVAL_MS = 10 * 60_000;
export const AGENT_TOKEN_SWEEP_GRACE_MS = 10 * 60_000;
export const AGENT_TOKEN_PRUNE_AFTER_MS = 7 * 24 * 60 * 60_000;

export interface AgentTokenSweepDeps {
  listAccessTokens: typeof listAccessTokens;
  getAgentState: (agentId: string) => { startedAt?: string; lastResumeAt?: string } | null;
  isAlive: (agentId: string) => ReturnType<typeof isAlive>;
  getConversationByName: (name: string) => { tmuxSession: string; status: 'active' | 'ended'; archivedAt: string | null } | null;
  revokeAgentMcpTokens: typeof revokeAgentMcpTokens;
  pruneEndedAccessTokens: typeof pruneEndedAccessTokens;
  now: () => number;
}

const defaultDeps: AgentTokenSweepDeps = {
  listAccessTokens,
  getAgentState,
  isAlive: (agentId) => isAlive(agentId),
  getConversationByName,
  revokeAgentMcpTokens,
  pruneEndedAccessTokens,
  now: () => Date.now(),
};

/** The newest of the given ISO times in epoch ms; -Infinity when none parses. */
function newestMs(...values: Array<string | undefined>): number {
  const parsed = values.map((value) => (value ? Date.parse(value) : Number.NaN)).filter((ms) => !Number.isNaN(ms));
  return parsed.length > 0 ? Math.max(...parsed) : Number.NEGATIVE_INFINITY;
}

/** Revoke one owner's tokens when D-9 says the owner is gone. Returns the count revoked. */
async function sweepOwner(record: PublicAccessTokenRecord, agentId: string, deps: AgentTokenSweepDeps, now: number): Promise<number> {
  const graceCutoff = now - AGENT_TOKEN_SWEEP_GRACE_MS;
  if (record.agentKind === 'conversation') {
    const conv = deps.getConversationByName(agentId);
    const ended = conv === null || conv.archivedAt !== null || (conv.status === 'ended' && Date.parse(record.createdAt) < graceCutoff);
    if (!ended) return 0;
    return deps.revokeAgentMcpTokens(agentId, { agentKind: 'conversation', dir: conversationStateDir(conv?.tmuxSession ?? `conv-${agentId}`) });
  }
  const state = deps.getAgentState(agentId);
  if (state === null) {
    // PAN-4932 D-9: planning launches mint before their first state save.
    if (Date.parse(record.createdAt) >= graceCutoff) return 0;
  } else {
    if (newestMs(record.createdAt, state.startedAt, state.lastResumeAt) >= graceCutoff) return 0;
    if (!isConfirmedDead(await deps.isAlive(agentId))) return 0;
  }
  return deps.revokeAgentMcpTokens(agentId);
}

/** One run (D-9). Returns { revoked, pruned }. Never throws. */
export async function sweepAgentTokensOnce(overrides: Partial<AgentTokenSweepDeps> = {}): Promise<{ revoked: number; pruned: number }> {
  const deps = { ...defaultDeps, ...overrides };
  let revoked = 0;
  try {
    const now = deps.now();
    const seen = new Set<string>();
    for (const record of await deps.listAccessTokens()) {
      if (record.revokedAt || record.agentId === undefined || record.agentKind === undefined) continue;
      const owner = `${record.agentKind}:${record.agentId}`;
      if (seen.has(owner)) continue;
      seen.add(owner);
      try {
        revoked += await sweepOwner(record, record.agentId, deps, now);
      } catch (error) {
        console.warn(`[agent-tokens] sweep skipped ${record.agentId} (token ${record.id}): ${(error as Error).message}`);
      }
    }
  } catch (error) {
    console.warn(`[agent-tokens] sweep could not list tokens: ${(error as Error).message}`);
  }
  let pruned = 0;
  try {
    pruned = await deps.pruneEndedAccessTokens(AGENT_TOKEN_PRUNE_AFTER_MS, deps.now());
  } catch (error) {
    console.warn(`[agent-tokens] prune failed: ${(error as Error).message}`);
  }
  if (revoked > 0 || pruned > 0) console.log(`[agent-tokens] sweep revoked ${revoked} token(s), pruned ${pruned} record(s)`);
  return { revoked, pruned };
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Bumped by every start and stop, so a run that ends after a stop (or a stop then start) never re-arms a stale chain. */
let generation = 0;
let started = false;

function schedule(delayMs: number, chain: number, overrides: Partial<AgentTokenSweepDeps>): void {
  timer = setTimeout(() => {
    timer = null;
    void sweepAgentTokensOnce(overrides).finally(() => {
      if (started && chain === generation) schedule(AGENT_TOKEN_SWEEP_INTERVAL_MS, chain, overrides);
    });
  }, delayMs);
  timer.unref?.();
}

/** D-10: first run 60 s after start, then 10 minutes after each run ends. Idempotent. `overrides` is a test seam. */
export function startAgentTokenSweep(overrides: Partial<AgentTokenSweepDeps> = {}): void {
  if (started) return;
  started = true;
  generation += 1;
  schedule(AGENT_TOKEN_SWEEP_FIRST_MS, generation, overrides);
}

export function stopAgentTokenSweep(): void {
  started = false;
  generation += 1;
  if (timer) clearTimeout(timer);
  timer = null;
}
