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
 *
 * `handleConversationPermissionAnswer` answers an on-screen prompt with arrows
 * + Enter after verifying the prompt's signature.
 */
import {
  getConversationById,
  getConversationByName,
  type LegacyConversation as Conversation,
} from './conversations.js';
import {
  parsePermissionPrompt,
  permissionKeystrokes,
  type PermissionChoice,
  type PermissionPrompt,
} from '../agents/permission-prompt.js';
import { resolveAgentPaneIo, type AgentPaneIo } from '../terminal-backends/agent-pane-io.js';
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
function threadCandidates(prompt: PermissionPrompt, entries: ConversationPermissionEntry[]): ConversationPermissionEntry[] {
  return entries.filter((entry) => (prompt.fromAgent === null) === (entry.agentKey === 'main'));
}

function entryForPrompt(prompt: PermissionPrompt, entries: ConversationPermissionEntry[]): ConversationPermissionEntry | null {
  const candidates = threadCandidates(prompt, entries);
  if (candidates.length === 1) return candidates[0]!;
  const detail = prompt.detailLines.join('\n');
  const matches = candidates.filter((entry) => {
    const preview = entry.toolInputPreview.slice(0, PREVIEW_MATCH_CHARS);
    return preview !== '' && detail.includes(preview);
  });
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Label when no registry entry was picked. Several candidates that cannot be
 * told apart are 'Unknown agent' (Decision 8). With none at all — the registry
 * is empty after a dashboard restart — the prompt's own title still says which
 * thread asked: " · from the <type> agent", or the main thread.
 */
function unmatchedLabel(prompt: PermissionPrompt, candidates: number): string {
  if (candidates > 1) return 'Unknown agent';
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
      agentLabel: entry ? entryLabel(entry) : unmatchedLabel(prompt, threadCandidates(prompt, entries).length),
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

export interface ConversationPermissionAnswerDeps {
  io?: Pick<AgentPaneIo, 'read' | 'sendKey'>;
  sleep?: (ms: number) => Promise<void>;
}

const PERMISSION_CHOICES: readonly PermissionChoice[] = ['allow-once', 'allow-always', 'deny'];
const KEYSTROKE_GAP_MS = 60;
const DELIVERY_CONFIRM_WAIT_MS = 700;

/**
 * POST /api/conversations/:id/permission — answer the permission prompt on
 * the conversation's pane. Re-reads the pane and refuses, sending no keys,
 * when the prompt is gone or is not the one the dialog rendered; after the
 * keys it re-reads and succeeds only when that prompt left the screen.
 */
export async function handleConversationPermissionAnswer(
  rawId: string,
  body: Record<string, unknown>,
  deps: ConversationPermissionAnswerDeps = {},
): Promise<{ body: Record<string, unknown>; status?: number }> {
  try {
    const choice = body['choice'];
    const signature = typeof body['signature'] === 'string' ? body['signature'] : '';
    if (typeof choice !== 'string' || !PERMISSION_CHOICES.includes(choice as PermissionChoice)) {
      return { body: { error: 'choice must be allow-once, allow-always or deny' }, status: 400 };
    }
    if (!signature) {
      return { body: { error: 'signature is required' }, status: 400 };
    }
    const conv = /^\d+$/.test(rawId) ? getConversationById(Number(rawId)) : getConversationByName(rawId);
    if (!conv) {
      return { body: { error: 'Conversation not found' }, status: 404 };
    }
    if (!isClaudeCodeConversation(conv)) {
      return { body: { error: 'Not a Claude Code conversation' }, status: 400 };
    }

    const io = deps.io ?? await resolveAgentPaneIo(conv.tmuxSession);
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

    const prompt = parsePermissionPrompt(await io.read(PANE_CAPTURE_LINES));
    if (!prompt) {
      return { body: { error: 'The permission prompt is no longer on screen', code: 'prompt-gone' }, status: 409 };
    }
    if (prompt.signature !== signature) {
      return { body: { error: 'The permission prompt changed since the dialog was rendered — refresh and re-answer', code: 'prompt-changed' }, status: 409 };
    }
    const keys = permissionKeystrokes(prompt, choice as PermissionChoice);
    if (!keys) {
      return { body: { error: `This prompt does not offer ${choice}`, code: 'choice-not-offered' }, status: 400 };
    }

    for (const key of keys) {
      await io.sendKey(key);
      await sleep(KEYSTROKE_GAP_MS);
    }

    await sleep(DELIVERY_CONFIRM_WAIT_MS);
    const after = parsePermissionPrompt(await io.read(PANE_CAPTURE_LINES));
    if (after && after.signature === signature) {
      return { body: { error: 'The keys were sent but the prompt is still up — answer it in the terminal', code: 'delivery-unconfirmed' }, status: 409 };
    }
    console.log(`[conversations] ${conv.name}: permission answered ${choice}`);
    return { body: { ok: true, answered: choice } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[conversations] permission answer failed:', message);
    return { body: { error: 'Internal server error' }, status: 500 };
  }
}
