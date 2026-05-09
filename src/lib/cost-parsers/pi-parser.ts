/**
 * Pi Coding Agent JSONL parser (PAN-636).
 *
 * Pi sessions live at:
 *   ~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<session-id>.jsonl
 *
 * Format (Pi v3):
 *   - First line:  { type: "session", version: 3, id, timestamp, cwd }
 *   - Subsequent:  every entry has an opaque `id` and a `parentId`. parentId
 *                  is null for the first non-session entry.
 *   - The graph is a tree (Pi supports forking/branching), not a list.
 *
 * To compute usage for the *active* branch we walk leaf -> root via parentId
 * from the latest leaf (max timestamp among entries that have no children).
 * Pi assistant messages report per-call usage — input/output tokens are NOT
 * cumulative across the conversation — so summing along the active branch is
 * correct without subtracting pre-compaction input.
 *
 * SessionUsage shape comes from jsonl-parser.ts (the Claude Code parser); we
 * map into it unchanged so all upstream consumers keep working.
 */

import { existsSync, readFileSync } from 'fs';
import type { SessionUsage } from './jsonl-parser.js';
import type { TokenUsage } from '../cost.js';

// Minimal entry shape we care about. Anything else is ignored.
interface PiSessionRoot {
  type: 'session';
  version: number;
  id: string;
  timestamp: string;
  cwd?: string;
}

interface PiUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

interface PiMessageEntry {
  type: 'message';
  id: string;
  parentId: string | null;
  timestamp: string;
  message: {
    role: 'user' | 'assistant' | 'toolResult';
    content?: unknown;
    model?: string;
    provider?: string;
    usage?: PiUsage;
  };
}

interface PiGenericEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  // any other fields permitted; we only inspect them when type is known.
  [key: string]: unknown;
}

type PiEntry = PiMessageEntry | PiGenericEntry;

function isMessage(entry: PiEntry): entry is PiMessageEntry {
  return entry.type === 'message';
}

function isAssistantMessage(entry: PiEntry): entry is PiMessageEntry {
  return isMessage(entry) && entry.message?.role === 'assistant';
}

function tsMs(timestamp: string | undefined): number {
  if (!timestamp) return 0;
  const t = Date.parse(timestamp);
  return Number.isFinite(t) ? t : 0;
}

interface ParseResult {
  ok: boolean;
  reason?: string;
  usage?: SessionUsage;
}

// Known top-level entry types. Anything else is logged once per session.
const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'session',
  'message',
  'model_change',
  'thinking_level_change',
  'compaction_start',
  'compaction_end',
  'session_before_compact',
  'session_compact',
  'session_before_switch',
  'session_before_fork',
  'session_start',
]);

/**
 * Parse a Pi session JSONL file into a SessionUsage record.
 *
 * Returns null if the file does not exist, is empty, or is unparseable. Errors
 * during line parsing are tolerated (the line is skipped); we never throw.
 */
export function parsePiSession(filePath: string): SessionUsage | null {
  if (!existsSync(filePath)) return null;
  const result = parsePiSessionContent(readFileSync(filePath, 'utf8'), filePath);
  return result.ok ? result.usage! : null;
}

/**
 * Parse Pi session JSONL content. Exposed for tests and callers that already
 * have the file content in memory.
 */
export function parsePiSessionContent(content: string, filePath = '<inline>'): ParseResult {
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  let root: PiSessionRoot | null = null;
  const entriesById = new Map<string, PiEntry>();
  const childrenOf = new Map<string | null, string[]>();
  const unknownTypesSeen = new Set<string>();

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const entry = parsed as PiEntry;

    if (entry.type === 'session') {
      root = entry as unknown as PiSessionRoot;
      continue;
    }

    if (!entry.id) continue;

    if (!KNOWN_TYPES.has(entry.type)) {
      if (!unknownTypesSeen.has(entry.type)) {
        unknownTypesSeen.add(entry.type);
        // eslint-disable-next-line no-console
        console.debug(`[pi-parser] unknown entry type "${entry.type}" in ${filePath} — ignoring`);
      }
      // Still track the entry in the graph so downstream branches stay linked.
    }

    entriesById.set(entry.id, entry);
    const list = childrenOf.get(entry.parentId ?? null);
    if (list) list.push(entry.id);
    else childrenOf.set(entry.parentId ?? null, [entry.id]);
  }

  if (!root) {
    return { ok: false, reason: 'missing-session-root' };
  }

  if (entriesById.size === 0) {
    // Session with only the root entry — return a minimal SessionUsage.
    return {
      ok: true,
      usage: emptyUsage(filePath, root),
    };
  }

  // Find leaves: entries that have no children.
  const leaves: PiEntry[] = [];
  for (const entry of entriesById.values()) {
    const kids = childrenOf.get(entry.id);
    if (!kids || kids.length === 0) leaves.push(entry);
  }
  if (leaves.length === 0) {
    // Cycle or all entries have children — fall back to "pick latest entry".
    leaves.push(...entriesById.values());
  }

  // Pick the latest leaf by timestamp; tie-break by file order via id appearance.
  let latestLeaf: PiEntry = leaves[0]!;
  for (const leaf of leaves) {
    if (tsMs(leaf.timestamp) > tsMs(latestLeaf.timestamp)) {
      latestLeaf = leaf;
    }
  }

  // Walk leaf -> root via parentId, collecting entries in reverse-chronological order.
  const branch: PiEntry[] = [];
  const visited = new Set<string>();
  let cursor: PiEntry | undefined = latestLeaf;
  while (cursor) {
    if (visited.has(cursor.id)) break; // cycle guard
    visited.add(cursor.id);
    branch.push(cursor);
    if (!cursor.parentId) break;
    cursor = entriesById.get(cursor.parentId);
  }
  branch.reverse(); // chronological

  // Aggregate usage and per-model breakdown across assistant messages on the
  // active branch.
  const totals: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  let costV2 = 0;
  let messageCount = 0;
  let costRecomputedFromTokens = 0;
  const modelBreakdown: Record<
    string,
    { cost: number; inputTokens: number; outputTokens: number; messageCount: number }
  > = {};
  const modelsInOrder: string[] = [];
  let compactionCount = 0;

  let firstTs: string | null = null;
  let lastTs: string | null = null;

  for (const entry of branch) {
    if (entry.type === 'compaction_start' || entry.type === 'session_compact') {
      compactionCount += 1;
    }
    if (!firstTs && entry.timestamp) firstTs = entry.timestamp;
    if (entry.timestamp) lastTs = entry.timestamp;

    if (!isAssistantMessage(entry)) continue;
    const usage = entry.message.usage;
    if (!usage) continue;
    const model = entry.message.model || 'unknown';
    const input = usage.input ?? 0;
    const output = usage.output ?? 0;
    const cacheRead = usage.cacheRead ?? 0;
    const cacheWrite = usage.cacheWrite ?? 0;
    const cost = usage.cost?.total ?? 0;
    const localComputed =
      (usage.cost?.input ?? 0) +
      (usage.cost?.output ?? 0) +
      (usage.cost?.cacheRead ?? 0) +
      (usage.cost?.cacheWrite ?? 0);

    totals.inputTokens += input;
    totals.outputTokens += output;
    totals.cacheReadTokens = (totals.cacheReadTokens ?? 0) + cacheRead;
    totals.cacheWriteTokens = (totals.cacheWriteTokens ?? 0) + cacheWrite;
    costV2 += cost;
    costRecomputedFromTokens += localComputed;
    messageCount += 1;

    if (!modelBreakdown[model]) {
      modelBreakdown[model] = { cost: 0, inputTokens: 0, outputTokens: 0, messageCount: 0 };
      modelsInOrder.push(model);
    }
    const slot = modelBreakdown[model]!;
    slot.cost += cost;
    slot.inputTokens += input;
    slot.outputTokens += output;
    slot.messageCount += 1;
  }

  // Observability: log Pi-inline-cost vs locally-recomputed-from-cost-fields
  // delta. This catches cases where Pi's pricing tables drift inside Pi
  // itself; we always trust costV2 (Pi's inline total).
  if (Math.abs(costV2 - costRecomputedFromTokens) > 1e-9) {
    // eslint-disable-next-line no-console
    console.debug(
      `[pi-parser] inline cost vs sum-of-line-items delta=${(costV2 - costRecomputedFromTokens).toFixed(6)} in ${filePath}`,
    );
  }
  if (compactionCount > 0) {
    // eslint-disable-next-line no-console
    console.debug(
      `[pi-parser] active branch in ${filePath} has ${compactionCount} compaction event(s) — usage summed per-message (no double-count)`,
    );
  }

  const display =
    modelsInOrder.length === 0
      ? 'unknown'
      : modelsInOrder.length === 1
        ? modelsInOrder[0]!
        : modelsInOrder.join(' → ');

  return {
    ok: true,
    usage: {
      sessionId: root.id,
      sessionFile: filePath,
      startTime: firstTs ?? root.timestamp,
      endTime: lastTs ?? root.timestamp,
      model: display,
      usage: totals,
      cost: costV2,
      cost_v2: costV2,
      messageCount,
      modelBreakdown,
    },
  };
}

function emptyUsage(filePath: string, root: PiSessionRoot): SessionUsage {
  return {
    sessionId: root.id,
    sessionFile: filePath,
    startTime: root.timestamp,
    endTime: root.timestamp,
    model: 'unknown',
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    cost: 0,
    cost_v2: 0,
    messageCount: 0,
    modelBreakdown: {},
  };
}
