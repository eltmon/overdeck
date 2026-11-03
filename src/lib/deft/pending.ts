/**
 * Deft's questions as dashboard pending questions (PAN-4849 WI-4, FR-14).
 *
 * An open Deft escalation of a blocking type becomes a `PendingQuestion` on
 * the issue's work agent, with tool id `deft-escalation:<id>`, so it shows in
 * Needs-you and the question dialog. An open `external` escalation is not a
 * question and not pending input (Deft: "dashboard indicator, no interrupt"):
 * it is only counted, into the enrichment's `deftExternalEscalations`.
 *
 * Escalation files change without the transcript changing, so the enrichment
 * reads them on every poll, outside its transcript-scan cache (hazard H1). A
 * 10 s per-worktree cache bounds the cost of that poll.
 *
 * This is the read side only. Answers live in `pending-answer.ts`, because
 * they deliver to the agent, and `agents/delivery.ts` imports back into
 * `agent-enrichment.ts`, which imports this module.
 */
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import type { DeftIssueState } from '@overdeck/contracts';
import { getAgentState } from '../agents/agent-state-read.js';
import { parseIssueId } from '../issue-id.js';
import { getIssueWorkspacePath } from '../overdeck/issue-projects.js';
import { isDeftPipelineIssue } from './issue-pipeline.js';
import { parseDeftMenu } from './menu-parser.js';
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
/** "Is this issue on Deft", per issue: the escalation and menu checks share one answer per poll window. */
const deftIssueCache = new Map<string, { at: number; isDeft: boolean }>();

/** Drop cached Deft state (one worktree, or all of it) and every cached "is on Deft" answer. */
export function clearDeftPendingCache(worktree?: string): void {
  if (worktree) stateCache.delete(worktree);
  else stateCache.clear();
  deftIssueCache.clear();
}

async function cachedIsDeft(issueId: string, deps: DeftPendingDeps): Promise<boolean> {
  const now = (deps.now ?? Date.now)();
  const hit = deftIssueCache.get(issueId);
  if (hit && now - hit.at < STATE_CACHE_MS) return hit.isDeft;
  const isDeft = await (deps.isDeft ?? isDeftPipelineIssue)(issueId);
  deftIssueCache.set(issueId, { at: now, isDeft });
  return isDeft;
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
  if (!(await cachedIsDeft(issueId, deps))) return null;
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

/** Open blocking escalations as pending questions, and how many `external` ones are open. */
export async function deftEscalationQuestions(
  agentId: string,
  deps: DeftPendingDeps = {},
): Promise<{ questions: DeftPendingQuestion[]; externalCount: number }> {
  const target = await deftIssueForAgent(agentId, deps);
  if (!target) return { questions: [], externalCount: 0 };
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
  return { questions, externalCount: open.filter(escalation => escalation.type === 'external').length };
}

const TRANSCRIPT_TAIL_BYTES = 64 * 1024;

/** The transcript's last 64 KiB as parsed JSONL records, oldest first; the first partial line is dropped. */
async function readTranscriptTail(jsonlPath: string): Promise<Array<Record<string, unknown>>> {
  const handle = await open(jsonlPath, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    if (length < size) lines.shift();
    return lines.flatMap(line => {
      if (!line.trim()) return [];
      try {
        const record: unknown = JSON.parse(line);
        return record && typeof record === 'object' && !Array.isArray(record) ? [record as Record<string, unknown>] : [];
      } catch {
        return [];
      }
    });
  } finally {
    await handle.close();
  }
}

type ContentBlock = { type?: unknown; text?: unknown };

function messageOf(record: Record<string, unknown>): { id?: unknown; content: ContentBlock[] } {
  const message = record.message as { id?: unknown; content?: unknown } | undefined;
  const content = Array.isArray(message?.content) ? (message!.content as ContentBlock[]) : [];
  return { id: message?.id, content };
}

/**
 * A Deft menu in the agent's last assistant message, as a single-select
 * pending question (tool id `deft-menu:<sha1(text)[0..12]>`). Null unless the
 * agent works a Deft issue and its last message is assistant text with no
 * tool call. Claude Code writes one record per content block, so the trailing
 * records of one assistant message are read together.
 */
export async function deftMenuQuestion(
  agentId: string,
  jsonlPath: string | null | (() => Promise<string | null>),
  deps: DeftPendingDeps = {},
): Promise<DeftPendingQuestion | null> {
  if (!(await deftIssueForAgent(agentId, deps))) return null;
  const path = typeof jsonlPath === 'function' ? await jsonlPath() : jsonlPath;
  if (!path) return null;
  const records = (await readTranscriptTail(path)).filter(record => record.type === 'assistant' || record.type === 'user');
  const last = records.at(-1);
  if (!last || last.type !== 'assistant') return null;
  const messageId = messageOf(last).id;
  const blocks: ContentBlock[] = [];
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]!;
    const message = messageOf(record);
    if (record.type !== 'assistant' || (i !== records.length - 1 && (messageId === undefined || message.id !== messageId))) break;
    blocks.unshift(...message.content);
  }
  if (blocks.some(block => block.type === 'tool_use')) return null;
  const text = blocks.flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n');
  const menu = parseDeftMenu(text);
  if (!menu) return null;
  return {
    toolId: `${DEFT_MENU_TOOL_ID_PREFIX}${createHash('sha1').update(text).digest('hex').slice(0, 12)}`,
    timestamp: typeof last.timestamp === 'string' ? last.timestamp : new Date(0).toISOString(),
    questions: [{
      header: 'Deft',
      question: menu.prompt || 'Deft is asking you to choose',
      multiSelect: false,
      options: menu.options.map(label => ({ label, description: '' })),
    }],
  };
}
