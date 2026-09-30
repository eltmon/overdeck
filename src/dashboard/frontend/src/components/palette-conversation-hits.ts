/**
 * Conversation-hit view model for the Ctrl+K palette (PAN-4358).
 *
 * The server groups fused chunk hits and title matches into one row per
 * conversation, banded into title/text/path tiers (see
 * `src/lib/conversation-search/group-hits.ts`). This module turns that wire
 * contract into the label/chips/openRequest shape `CommandPalette.tsx` renders,
 * kept out of that file so it stays testable without React and doesn't grow
 * `CommandPalette.tsx` past its file-size allowlist cap.
 */

export interface PaletteConversationHit {
  /** Best chunk's session id; title-only rows: the conversation's Claude session locator, else conversationId. */
  sessionId: string;
  conversationId: string;
  /** Best chunk's encoded ~/.claude/projects dir; '' for title-only rows. */
  projectId: string;
  /** Resolved dashboard project key (name ?? key), or null when under no registered project. */
  projectKey: string | null;
  /** Parent session UUID when the hit is a Claude subagent transcript (PAN-3982). */
  parentSessionId?: string | null;
  /** Bare subagent id (`agent-<id>.jsonl` → `<id>`). */
  subagentId?: string | null;
  /** Conversation title (manual or AI-refined); null when the row has none or no conversation row exists. */
  title: string | null;
  /** True when the conversation row is archived (PAN-4358). */
  archived: boolean;
  /** Ranking band: title match > prose/semantic transcript match > path/tool-output-only match. */
  matchTier: 'title' | 'text' | 'path';
  /** Chunk hits for this conversation in the candidate pool; 0 for title-only rows. */
  hitCount: number;
  role: string;
  ts: string | null;
  /** Byte offset of the best chunk; null for title-only rows (open without a message target). */
  byteOffset: number | null;
  displayContent: string;
  excerpt: string;
  excerptSegments: Array<{ text: string; match: boolean }>;
  rank: number;
}

export interface ConversationPaletteOpenRequest {
  sessionId: string;
  conversationId: string;
  projectId: string;
  /** Resolved dashboard project key (name ?? key), or null when under no registered project. */
  projectKey: string | null;
  /** Null for a title-only hit — open without a message target (PAN-4358 D13). */
  byteOffset: number | null;
  label: string;
  sourceLabel?: string;
  /** Bare subagent id when the hit is a subagent transcript; opens on the parent (PAN-3982). */
  subagentId?: string | null;
}

export interface ConversationHitChip {
  text: string;
  kind: 'project' | 'issue' | 'source' | 'date' | 'role' | 'hits' | 'archived';
}

export interface ConversationHitDescription {
  label: string;
  sourceLabel: string;
  subagentId: string | null;
  chips: ConversationHitChip[];
  tier: number;
  openRequest: ConversationPaletteOpenRequest;
}

/** Ranking band order: title matches first, then transcript prose, then path/tool-output noise. */
export const MATCH_TIER_ORDER = { title: 0, text: 1, path: 2 } as const;

/**
 * Turn a Claude project-dir id (the cwd with '/' encoded as '-', e.g.
 * `-home-eltmon-Projects-overdeck`) into a human label like
 * `overdeck`, or `overdeck · feature-pan-1053` for a workspace.
 * The encoding is lossy (a real '-' is indistinguishable from a path separator),
 * so we anchor on the `Projects` segment and fall back to the trailing segment.
 */
export function friendlyProjectLabel(projectId: string): string {
  if (!projectId) return '';
  const segs = projectId.replace(/^-+/, '').split('-').filter(Boolean);
  if (segs.length === 0) return projectId;
  const projectsIdx = segs.lastIndexOf('Projects');
  const after = projectsIdx >= 0 ? segs.slice(projectsIdx + 1) : segs;
  const wsIdx = after.indexOf('workspaces');
  if (wsIdx >= 0) {
    const base = after.slice(0, wsIdx).join('-') || segs[segs.length - 1] || projectId;
    const ws = after.slice(wsIdx + 1).join('-');
    return ws ? `${base} · ${ws}` : base;
  }
  if (projectsIdx >= 0) return after.join('-') || projectId;
  // No `Projects` anchor — best effort: the cwd basename (last segment).
  return after[after.length - 1] || projectId;
}

export function issueIdFromProjectLabel(label: string): string | null {
  const match = label.match(/\bfeature-([a-z]+)-(\d+)\b/i);
  if (!match) return null;
  return `${match[1]!.toUpperCase()}-${match[2]}`;
}

/** Compact, human-friendly timestamp: "Today 18:30", "Yesterday 09:12", "Jun 9", "Jun 9, 2025". */
export function formatHitDate(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return `Today ${hhmm}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${hhmm}`;
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}

export function describeConversationHit(hit: PaletteConversationHit): ConversationHitDescription {
  const fullLabel = hit.title?.trim() || hit.displayContent || hit.conversationId || hit.sessionId;
  const label = fullLabel.length > 80 ? `${fullLabel.slice(0, 77)}…` : fullLabel;

  const project = friendlyProjectLabel(hit.projectId) || hit.projectKey || '';
  const issueId = issueIdFromProjectLabel(project);

  // A subagent hit opens through its parent conversation (PAN-3982).
  const subagentId = hit.subagentId ?? null;
  const rootSessionId = hit.parentSessionId ?? hit.sessionId;
  // A title-only row (byteOffset null) always has a real conversation row —
  // title matching requires a non-null title — even when its sessionId falls
  // back to the conversationId (no claude-code file), so it must not read as
  // a bare "Claude session" chip (PAN-4358 review).
  const isDashboardConversation = hit.byteOffset === null || hit.conversationId !== rootSessionId;
  const rootLabel = isDashboardConversation
    ? `Conversation ${hit.conversationId}`
    : `Claude session ${rootSessionId.slice(0, 8)}`;
  const sourceLabel = subagentId ? `Subagent of ${rootLabel}` : rootLabel;

  const date = formatHitDate(hit.ts);

  const chips: ConversationHitChip[] = [];
  if (project) chips.push({ kind: 'project', text: project });
  if (issueId) chips.push({ kind: 'issue', text: issueId });
  chips.push({ kind: 'source', text: sourceLabel });
  if (date) chips.push({ kind: 'date', text: date });
  if (hit.role) chips.push({ kind: 'role', text: hit.role });
  if (hit.hitCount > 1) chips.push({ kind: 'hits', text: `${hit.hitCount} hits` });
  if (hit.archived) chips.push({ kind: 'archived', text: 'archived' });

  return {
    label,
    sourceLabel,
    subagentId,
    chips,
    tier: MATCH_TIER_ORDER[hit.matchTier],
    openRequest: {
      sessionId: hit.sessionId,
      conversationId: hit.conversationId,
      projectId: hit.projectId,
      projectKey: hit.projectKey,
      byteOffset: hit.byteOffset,
      label: fullLabel,
      sourceLabel,
      subagentId,
    },
  };
}
