/**
 * PAN-3677: positive transcript proof of the planning background-task wedge.
 *
 * The incident: planning sessions (planning-min-888 / planning-min-889) hung on
 * the provider call that followed their background Explore children reaching a
 * terminal state — one run with both children finished, one with a child dead
 * from the 262,144-token model limit while its sibling finished. The mirror
 * stayed 'active' (the Stop hook never fired), the pane kept repainting its
 * spinner, and queued `pan tell` messages were never processed.
 *
 * Stuck-remediation must NEVER interrupt a turn it cannot prove is wedged: a
 * healthy long reasoning turn is also mirror-'active' with no tool calls for
 * a while. This module supplies the positive signature from the authoritative
 * source — the session JSONL:
 *
 *   1. the parent launched at least one background child IN THE CURRENT TURN
 *      (Agent tool result: "Async agent launched successfully. … agentId: X");
 *   2. EVERY child launched since that boundary is proven terminal, via either
 *      - a task-notification queue-operation carrying a terminal
 *        `<status>` (completed / failed / cancelled / killed), or
 *      - a TaskOutput tool result for that task id with a terminal `<status>`.
 *
 * TURN SCOPING: at each genuine prompt boundary — a `user` entry with
 * string/text content (kickoff, recovery-resume seed) or a queue-operation
 * `remove` of a non-task-notification message (a consumed `pan tell`) —
 * children already proven TERMINAL are retired from the evidence; a closed
 * explorer batch from earlier in the session can never keep `wedged` true
 * through a later healthy turn (historical poisoning). Children NOT yet
 * terminal carry across the boundary, because real background tasks outlive
 * user turns: in the MIN-888 transcript the operator's `pan tell` was consumed
 * while the API explorer was still running, and the wedge formed only after
 * that child finished. `user` entries carrying tool_result parts are turn
 * machinery, never boundaries.
 *
 * If proof is missing — no background children since the boundary, or any
 * child without terminal proof — the answer is NOT wedged and the caller must
 * not interrupt. The detector is deliberately blind to everything else
 * (model, prompt, wall clock): those judgments live in the remediation
 * ladder.
 *
 * Known limitation: a task id can notify more than once (a finished child can
 * be resumed and run again within the same turn). Re-resume is rare in
 * planning flows and the ladder's one-stage-per-episode guard bounds the cost
 * of a stale read; if it ever false-fires, the interrupt is an Escape —
 * recoverable, transcript-safe.
 */
import { readFileSync } from 'fs';
import { resolveLatestSessionIdSync } from '../agents/activity.js';
import { sessionFilePath } from '../paths.js';

/** Terminal background-task statuses recognized in notifications / TaskOutput results. */
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled', 'killed', 'error']);

export interface BackgroundTaskWedgeEvidence {
  /** Every async background child the parent launched, in launch order. */
  launchedTaskIds: string[];
  /** Children with terminal proof (notification or TaskOutput result). */
  terminalTaskIds: string[];
  /** Launched children with NO terminal proof — any non-empty list vetoes the wedge. */
  nonTerminalTaskIds: string[];
  /** Terminal children whose notification was enqueued but not yet consumed by the harness. */
  unconsumedTerminalTaskIds: string[];
  /** The positive signature: at least one child launched and every child terminal. */
  wedged: boolean;
}

interface TaskNotification {
  taskId: string;
  status: string | null;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object') {
          const p = part as Record<string, unknown>;
          if (p.type === 'text' && typeof p.text === 'string') return p.text;
          if (p.type === 'tool_result') return extractText(p.content);
        }
        return '';
      })
      .join('\n');
  }
  return '';
}

function parseTaskNotification(content: string): TaskNotification | null {
  if (!content.includes('<task-notification>')) return null;
  const taskId = /<task-id>\s*([a-z0-9]+)\s*<\/task-id>/.exec(content)?.[1];
  if (!taskId) return null;
  const status = /<status>\s*([a-z_-]+)\s*<\/status>/i.exec(content)?.[1]?.toLowerCase() ?? null;
  return { taskId, status };
}

/**
 * True when a JSONL entry opens a new genuine user turn: a `user` entry with
 * string or text-only content (the kickoff prompt, a recovery-resume seed),
 * or a queue-operation `remove` of a NON-task-notification message (a
 * consumed operator `pan tell` — the harness folds it into context at that
 * point without writing a user entry). `user` entries made of tool_result
 * parts are turn machinery and NEVER boundaries; task-notification
 * queue-operations are the wedge evidence itself, also never boundaries.
 */
function isPromptBoundary(e: Record<string, unknown>): boolean {
  if (e.type === 'queue-operation') {
    const content = typeof e.content === 'string' ? e.content : '';
    return e.operation === 'remove' && !content.includes('<task-notification>');
  }
  if (e.type !== 'user') return false;
  const content = (e.message as Record<string, unknown> | undefined)?.content;
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) {
    const hasToolResult = content.some(
      (p) => p && typeof p === 'object' && (p as Record<string, unknown>).type === 'tool_result',
    );
    const hasText = content.some(
      (p) => p && typeof p === 'object' && (p as Record<string, unknown>).type === 'text',
    );
    return hasText && !hasToolResult;
  }
  return false;
}

/**
 * Parse one session's JSONL entries (already-parsed JSON objects, in file
 * order) into the wedge evidence. At every genuine prompt boundary (see
 * isPromptBoundary), children already proven terminal are RETIRED — only
 * still-running children carry into the new turn, because real background
 * tasks outlive user turns. Unknown/malformed lines are ignored — a parser
 * miss always degrades to "not wedged", never to a false positive.
 */
export function parseBackgroundTaskWedge(entries: readonly unknown[]): BackgroundTaskWedgeEvidence {
  let launched: string[] = [];
  let terminal = new Map<string, string>(); // taskId -> terminal status
  let consumedNotifications = new Set<string>();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;

    if (isPromptBoundary(e)) {
      // Retire children already proven terminal — their episode is closed and
      // must not poison later turns. Keep only still-running children: real
      // background tasks outlive user turns (see the header's MIN-888 note).
      launched = launched.filter((id) => !terminal.has(id));
      terminal = new Map([...terminal].filter(([id]) => launched.includes(id)));
      consumedNotifications = new Set([...consumedNotifications].filter((id) => launched.includes(id)));
      continue;
    }

    if (e.type === 'queue-operation') {
      const notification = parseTaskNotification(typeof e.content === 'string' ? e.content : '');
      if (!notification) continue;
      if (e.operation === 'remove') consumedNotifications.add(notification.taskId);
      if (notification.status && TERMINAL_TASK_STATUSES.has(notification.status)) {
        terminal.set(notification.taskId, notification.status);
      }
      continue;
    }

    // tool_result entries arrive as role:'user' messages with content parts.
    const message = e.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      if (p.type !== 'tool_result') continue;
      const text = extractText(p.content);

      // Background launch acknowledgment: "Async agent launched successfully.
      // … agentId: <id> (internal ID …)".
      if (text.includes('Async agent launched successfully')) {
        const agentId = /agentId:\s*([a-z0-9]+)/.exec(text)?.[1];
        if (agentId && !launched.includes(agentId)) launched.push(agentId);
        continue;
      }

      // Explicit collection: TaskOutput result with <task_id> + <status>.
      if (text.includes('<retrieval_status>')) {
        const taskId = /<task_id>\s*([a-z0-9]+)\s*<\/task_id>/.exec(text)?.[1];
        const status = /<status>\s*([a-z_-]+)\s*<\/status>/i.exec(text)?.[1]?.toLowerCase();
        if (taskId && status && TERMINAL_TASK_STATUSES.has(status)) {
          terminal.set(taskId, status);
          consumedNotifications.add(taskId);
        }
      }
    }
  }

  const terminalTaskIds = launched.filter((id) => terminal.has(id));
  const nonTerminalTaskIds = launched.filter((id) => !terminal.has(id));
  const unconsumedTerminalTaskIds = terminalTaskIds.filter((id) => !consumedNotifications.has(id));
  return {
    launchedTaskIds: launched,
    terminalTaskIds,
    nonTerminalTaskIds,
    unconsumedTerminalTaskIds,
    wedged: launched.length > 0 && nonTerminalTaskIds.length === 0,
  };
}

/**
 * Read a session JSONL and return its wedge evidence, or null when the file
 * cannot be read/parsed — callers treat null as "not proven", never as wedged.
 */
export function readBackgroundTaskWedgeEvidence(sessionPath: string): BackgroundTaskWedgeEvidence | null {
  let raw: string;
  try {
    raw = readFileSync(sessionPath, 'utf-8');
  } catch {
    return null;
  }
  const entries: unknown[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Tolerate torn tail writes — a partially-written last line must not
      // discard the evidence parsed before it.
    }
  }
  return parseBackgroundTaskWedge(entries);
}

/**
 * Resolve an agent's CURRENT session through the production resolver
 * (resolveLatestSessionIdSync — the same door resumeAgent uses) and parse its
 * live JSONL. Returns null when there is no resumable session or no readable
 * transcript — always degrading to "not proven".
 */
export function readAgentBackgroundTaskWedgeEvidence(
  agentId: string,
  workspace: string,
): BackgroundTaskWedgeEvidence | null {
  const sessionId = resolveLatestSessionIdSync(agentId).sessionId;
  if (!sessionId) return null;
  return readBackgroundTaskWedgeEvidence(sessionFilePath(workspace, sessionId));
}
