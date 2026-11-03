/**
 * Deft's questions as dashboard pending questions (PAN-4849 WI-4, FR-14).
 *
 * An open Deft escalation of a blocking type becomes a `PendingQuestion` on
 * the issue's work agent, with tool id `deft-escalation:<id>`, so it shows in
 * Needs-you and the question dialog. An open `external` escalation is not a
 * question: it only marks the agent with the non-blocking `deftExternal` kind.
 *
 * Escalation files change without the transcript changing, so the enrichment
 * reads them on every poll, outside its transcript-scan cache (hazard H1). A
 * 10 s per-worktree cache bounds the cost of that poll.
 *
 * This is the read side only. Answers live in `pending-answer.ts`, because
 * they deliver to the agent, and `agents/delivery.ts` imports back into
 * `agent-enrichment.ts`, which imports this module.
 */
import type { DeftIssueState } from '@overdeck/contracts';
import { getAgentState } from '../agents/agent-state-read.js';
import { parseIssueId } from '../issue-id.js';
import { getIssueWorkspacePath } from '../overdeck/issue-projects.js';
import { isDeftPipelineIssue } from './issue-pipeline.js';
import { readDeftIssueState } from './state-reader.js';

export const DEFT_ESCALATION_TOOL_ID_PREFIX = 'deft-escalation:';
export const DEFT_MENU_TOOL_ID_PREFIX = 'deft-menu:';

/**
 * Structurally the same as `PendingQuestion` in `agent-enrichment.ts`, which
 * imports this module; importing the type back (even `import type`) would add
 * an import cycle that `lint:circular` counts.
 */
export interface DeftPendingQuestion {
  toolId: string;
  timestamp: string;
  questions: Array<{
    question: string;
    context?: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
}

export interface DeftPendingDeps {
  isDeft?: (issueId: string) => Promise<boolean>;
  agentWorkspace?: (agentId: string) => string | null;
  readState?: (worktree: string, issueId: string, now: number) => Promise<DeftIssueState>;
  now?: () => number;
}

const STATE_CACHE_MS = 10_000;
const stateCache = new Map<string, { at: number; state: DeftIssueState }>();

/** Drop cached Deft state (one worktree, or all of it). */
export function clearDeftPendingCache(worktree?: string): void {
  if (worktree) stateCache.delete(worktree);
  else stateCache.clear();
}

function defaultAgentWorkspace(agentId: string): string | null {
  const state = getAgentState(agentId);
  return state?.workspace ?? (state?.issueId ? getIssueWorkspacePath(state.issueId) : null);
}

/** The Deft issue a work agent (`agent-<issue>`) runs, with its worktree; null for anything else. */
export async function deftIssueForAgent(
  agentId: string,
  deps: DeftPendingDeps = {},
): Promise<{ issueId: string; worktree: string } | null> {
  if (!agentId.startsWith('agent-')) return null;
  const candidate = agentId.slice('agent-'.length);
  if (!parseIssueId(candidate)) return null;
  const issueId = candidate.toUpperCase();
  if (!(await (deps.isDeft ?? isDeftPipelineIssue)(issueId))) return null;
  const worktree = (deps.agentWorkspace ?? defaultAgentWorkspace)(agentId);
  return worktree ? { issueId, worktree } : null;
}

async function cachedState(worktree: string, issueId: string, deps: DeftPendingDeps): Promise<DeftIssueState> {
  const now = (deps.now ?? Date.now)();
  const hit = stateCache.get(worktree);
  if (hit && now - hit.at < STATE_CACHE_MS) return hit.state;
  const state = await (deps.readState ?? readDeftIssueState)(worktree, issueId, now);
  stateCache.set(worktree, { at: now, state });
  return state;
}

const DECISION_OPTIONS = [
  { label: 'Approve', description: 'Resolve as approved' },
  { label: 'Deny', description: 'Resolve as denied' },
  { label: 'Dismiss', description: 'Resolve as dismissed' },
];
const DISMISS_ONLY = [DECISION_OPTIONS[2]!];

/** Open blocking escalations as pending questions, and whether an `external` one is open. */
export async function deftEscalationQuestions(
  agentId: string,
  deps: DeftPendingDeps = {},
): Promise<{ questions: DeftPendingQuestion[]; hasExternal: boolean }> {
  const target = await deftIssueForAgent(agentId, deps);
  if (!target) return { questions: [], hasExternal: false };
  const state = await cachedState(target.worktree, target.issueId, deps);
  const open = state.escalations.filter(escalation => escalation.status === 'open');
  const questions = open
    .filter(escalation => escalation.type !== 'external')
    .map((escalation): DeftPendingQuestion => {
      const decides = escalation.type === 'cmd_approval' || escalation.type === 'approval';
      return {
        toolId: `${DEFT_ESCALATION_TOOL_ID_PREFIX}${escalation.id}`,
        timestamp: escalation.createdAt,
        questions: [{
          header: escalation.type,
          question: decides ? escalation.title : `${escalation.title}\n\nType your answer in the note.`,
          context: `${escalation.body}\n\nSLA ${escalation.slaHours}h (due ${escalation.dueAt})${escalation.dangerous ? '\nDANGEROUS' : ''}`,
          multiSelect: false,
          options: decides ? DECISION_OPTIONS : DISMISS_ONLY,
        }],
      };
    });
  return { questions, hasExternal: open.some(escalation => escalation.type === 'external') };
}
