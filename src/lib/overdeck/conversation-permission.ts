/**
 * PAN-4278: terminal permission prompts in Claude Code conversations.
 *
 * `conversationPendingPermission` combines two sources into the
 * `pendingPermission` field of the pending-input feed and the conversation
 * read:
 *
 *  - the pane, read through `resolveAgentPaneIo` (Herdr or tmux) and parsed by
 *    `parsePermissionPrompt`. It is the authority: only a prompt on screen is
 *    `answerable`.
 *  - the hook registry (`conversation-permission-registry.ts`), which names
 *    the agent that asked and when. A registry entry with no prompt on screen
 *    yields an `answerable: false` row — the dialog then offers only "Open
 *    terminal", never keys.
 */
import type { LegacyConversation as Conversation } from './conversations.js';
import { parsePermissionPrompt, type PermissionChoice, type PermissionPrompt } from '../agents/permission-prompt.js';
import { resolveAgentPaneIo } from '../terminal-backends/agent-pane-io.js';
import { PANE_CAPTURE_LINES } from '../session-pane-choice.js';
import {
  firstSeenAt,
  listPermissionRequests,
  type ConversationPermissionEntry,
} from './conversation-permission-registry.js';

export interface PendingPermission {
  signature: string | null;          // null when not answerable
  answerable: boolean;
  agentLabel: string;                // 'Main agent' | `Subagent: ${description or type}` | 'Unknown agent'
  agentKey: string | null;
  toolName: string | null;           // registry tool, else parsed header
  header: string | null;
  detailLines: string[];
  reason: string | null;
  options: Array<{ choice: PermissionChoice; label: string }>;
  since: string;                     // registry requestedAt, else when the pane first showed this prompt
}

export interface ConversationPermissionDeps {
  read?: (agentId: string) => Promise<string>;
  now?: () => string;
}

export interface ConversationPermissionRead {
  pendingPermission: PendingPermission | null;
  /**
   * The screen this read used, when it came from a tmux pane: the PAN-3113
   * pane-choice check reuses it instead of capturing again. Null for Herdr,
   * whose pane the tmux-only pane-choice path cannot answer.
   */
  tmuxPaneText: string | null;
}

const PREVIEW_MATCH_CHARS = 80;

function isClaudeCodeConversation(conv: Conversation): boolean {
  return (conv.harness ?? 'claude-code') === 'claude-code';
}

function entryLabel(entry: ConversationPermissionEntry): string {
  if (entry.agentKey === 'main') return 'Main agent';
  const name = entry.agentDescription ?? entry.agentType ?? entry.agentId;
  return name ? `Subagent: ${name}` : 'Unknown agent';
}

/**
 * The registry entry that raised the on-screen prompt. The prompt's title
 * says whether a subagent asked (" · from the <type> agent"), which narrows the
 * candidates to that thread; one candidate wins outright, several are told
 * apart by their input preview appearing in the prompt's detail lines.
 */
function entryForPrompt(prompt: PermissionPrompt, entries: ConversationPermissionEntry[]): ConversationPermissionEntry | null {
  const candidates = entries.filter((entry) => (prompt.fromAgent === null) === (entry.agentKey === 'main'));
  if (candidates.length === 1) return candidates[0]!;
  const detail = prompt.detailLines.join('\n');
  const matches = candidates.filter((entry) => {
    const preview = entry.toolInputPreview.slice(0, PREVIEW_MATCH_CHARS);
    return preview !== '' && detail.includes(preview);
  });
  return matches.length === 1 ? matches[0]! : null;
}

/** Label from the screen alone: the title's " · from the <type> agent" suffix, or the main thread. */
function promptLabel(prompt: PermissionPrompt): string {
  return prompt.fromAgent !== null ? `Subagent: ${prompt.fromAgent}` : 'Main agent';
}

/** Build the feed row from a pane screen (or null when unread) and the registry. */
export function pendingPermissionFromPane(
  conv: Conversation,
  paneText: string | null,
  now: string,
): PendingPermission | null {
  const entries = listPermissionRequests(conv.name);
  const prompt = paneText ? parsePermissionPrompt(paneText) : null;
  if (prompt) {
    const entry = entryForPrompt(prompt, entries);
    return {
      signature: prompt.signature,
      answerable: true,
      agentLabel: entry ? entryLabel(entry) : promptLabel(prompt),
      agentKey: entry?.agentKey ?? (prompt.fromAgent === null ? 'main' : null),
      toolName: entry?.toolName || prompt.header,
      header: prompt.header,
      detailLines: [...prompt.detailLines],
      reason: prompt.reason,
      options: prompt.options.map((option) => ({ choice: option.choice, label: option.label })),
      since: entry?.requestedAt ?? firstSeenAt(conv.name, prompt.signature, now),
    };
  }
  const oldest = entries[0];
  if (!oldest) return null;
  return {
    signature: null,
    answerable: false,
    agentLabel: entryLabel(oldest),
    agentKey: oldest.agentKey,
    toolName: oldest.toolName || null,
    header: null,
    detailLines: oldest.toolInputPreview ? [oldest.toolInputPreview] : [],
    reason: null,
    options: [],
    since: oldest.requestedAt,
  };
}

/** One pane read plus the registry → the conversation's pending permission. */
export async function readConversationPermission(
  conv: Conversation,
  deps: ConversationPermissionDeps = {},
): Promise<ConversationPermissionRead> {
  if (!isClaudeCodeConversation(conv)) return { pendingPermission: null, tmuxPaneText: null };
  const now = deps.now?.() ?? new Date().toISOString();
  let paneText: string | null = null;
  let backend: 'herdr' | 'tmux' | null = null;
  try {
    if (deps.read) {
      paneText = await deps.read(conv.tmuxSession);
    } else {
      const io = await resolveAgentPaneIo(conv.tmuxSession);
      backend = io.backend;
      paneText = await io.read(PANE_CAPTURE_LINES);
    }
  } catch {
    // An unreadable pane is "no prompt on screen"; the registry may still speak.
    paneText = null;
  }
  return {
    pendingPermission: pendingPermissionFromPane(conv, paneText, now),
    tmuxPaneText: backend === 'tmux' ? paneText : null,
  };
}

export async function conversationPendingPermission(
  conv: Conversation,
  deps: ConversationPermissionDeps = {},
): Promise<PendingPermission | null> {
  return (await readConversationPermission(conv, deps)).pendingPermission;
}
