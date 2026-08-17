/**
 * Conversation transcript adapter.
 *
 * Each agent harness writes its session transcript in its own JSONL shape:
 *
 * - Claude Code records have top-level `type: 'user'|'assistant'|'system'`,
 *   with `entry.message.content` as a block array whose blocks are
 *   `text|tool_use|tool_result|thinking`.
 * - Pi records have top-level `type: 'message'|'session'|'model_change'|
 *   'thinking_level_change'|...`, with the user/assistant role nested in
 *   `entry.message.role` and blocks of type `text|thinking|toolCall|toolResult`.
 * - ACP records have top-level `role`, `content`, and optional normalized
 *   `toolCalls` written by the persistent ACP host.
 * - Codex rollout records have top-level `type: 'event_msg'|'response_item'`
 *   with user/assistant messages and tool calls nested in `entry.payload`.
 * - Future harnesses will have their own shapes.
 *
 * The handoff authoring pipeline doesn't care about any of that. It needs
 * one thing from each harness: a canonical "<conversation>...</conversation>"
 * text it can feed the authoring model.
 *
 * This module provides that abstraction. Adding a new harness is two short
 * functions (resolveSessionFile + serialize) plus a registry entry — the
 * fork pipeline never needs to learn about the new harness.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';

import { resolveCodexRolloutPath } from '../../dashboard/server/routes/jsonl-resolver.js';
import type { AcpTranscriptEntry, AcpTranscriptToolCallState } from '../acp/transcript.js';
import type { RuntimeName } from '../runtimes/types.js';
import { getOverdeckHome, sessionFilePath } from '../paths.js';
import { findKimiWirePathAsync } from '../runtimes/kimi-code.js';
import {
  parseEntries as parseClaudeCodeEntries,
  serializeConversation as serializeClaudeCodeConversation,
  generateSmartSummary,
  summarizeSerializedText,
} from './smart-compaction.js';
import { primeAgentAdapter } from './prime-transcript-adapter.js';
import type { ConversationTranscriptAdapter } from './transcript-adapter-types.js';
export type { CompactSummaryOptions, ConversationTranscriptAdapter } from './transcript-adapter-types.js';

// ─── Claude Code ──────────────────────────────────────────────────────────

const claudeCodeAdapter: ConversationTranscriptAdapter = {
  name: 'claude-code',
  supportsPlainForkAsSource: true,
  supportsSourceAuthoredHandoff: true,

  async resolveSessionFile(conv) {
    if (!conv.claudeSessionId) return null;
    const path = sessionFilePath(conv.cwd, conv.claudeSessionId);
    return existsSync(path) ? path : null;
  },

  async serializeTranscript(sessionFile, options) {
    const entries = await parseClaudeCodeEntries(sessionFile);
    return serializeClaudeCodeConversation(entries, options?.includeThinking ?? true);
  },

  async compactSummary(sessionFile, options) {
    // Claude Code keeps the entry-aware smart-compaction flow: it parses the
    // JSONL into typed entries, finds compact boundaries, and carries file-op
    // detail into the summary. This is richer than text-only chunking.
    const result = await Effect.runPromise(
      generateSmartSummary({
        jsonlPath: sessionFile,
        model: options?.model,
        richMode: options?.richMode ?? false,
        mode: 'fork',
        includeThinkingInSummary: options?.includeThinking ?? true,
        harness: options?.harness ?? 'claude-code',
      }),
    );
    return { summary: result.summary, summaryModel: result.summaryModel };
  },
};

// ─── Pi ───────────────────────────────────────────────────────────────────

/**
 * Pi sessions live at:
 *   `~/.overdeck/agents/<tmuxSession>/sessions/<iso-timestamp>_<id>.jsonl`
 *
 * Pi may rotate session files (e.g. on resume), so we pick the
 * newest by filename — filenames sort lexicographically by their
 * ISO timestamp prefix so this is deterministic.
 */
async function resolvePiSessionFileFromTmux(tmuxSession: string): Promise<string | null> {
  const sessionDir = join(getOverdeckHome(), 'agents', tmuxSession, 'sessions');
  if (!existsSync(sessionDir)) return null;
  try {
    const entries = (await readdir(sessionDir)).filter((name) => name.endsWith('.jsonl'));
    if (entries.length === 0) return null;
    entries.sort();
    return join(sessionDir, entries[entries.length - 1]!);
  } catch {
    return null;
  }
}

interface PiEntry {
  type?: string;
  message?: {
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      thinking?: string;
      name?: string;
      arguments?: unknown;
    }>;
  };
}

function serializePiEntry(entry: PiEntry, includeThinking: boolean): string | undefined {
  if (entry.type !== 'message') return undefined;
  const role = entry.message?.role;
  if (role !== 'user' && role !== 'assistant') return undefined;

  const content = entry.message?.content;
  if (!Array.isArray(content)) return undefined;

  const lines: string[] = [`[${role}]`];
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      lines.push(block.text);
    } else if (block?.type === 'thinking' && includeThinking && typeof block.thinking === 'string' && block.thinking.trim()) {
      lines.push(`[thinking]\n${block.thinking}`);
    } else if (block?.type === 'toolCall' && typeof block.name === 'string') {
      let args = '';
      try {
        args = JSON.stringify(block.arguments).slice(0, 500);
      } catch {
        args = '<unserializable>';
      }
      lines.push(`[tool_use: ${block.name}]\n${args}`);
    }
    // toolResult, function-call envelopes, etc. are intentionally skipped — the
    // surface we care about for handoff is what the user said, what the agent
    // said, what tools it ran, and what it was thinking. Tool outputs balloon
    // the transcript without adding signal a handoff doc needs.
  }
  if (lines.length === 1) return undefined; // header only — no content
  return lines.join('\n');
}

const piAdapter: ConversationTranscriptAdapter = {
  name: 'ohmypi',
  supportsPlainForkAsSource: false,
  supportsSourceAuthoredHandoff: false,

  async resolveSessionFile(conv) {
    return resolvePiSessionFileFromTmux(conv.tmuxSession);
  },

  async serializeTranscript(sessionFile, options) {
    const includeThinking = options?.includeThinking ?? true;
    const content = await readFile(sessionFile, 'utf-8');
    const parts: string[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let entry: PiEntry;
      try {
        entry = JSON.parse(line) as PiEntry;
      } catch {
        continue;
      }
      const serialized = serializePiEntry(entry, includeThinking);
      if (serialized) parts.push(serialized);
    }
    return parts.join('\n\n');
  },

  async compactSummary(sessionFile, options) {
    // Pi's JSONL shape is not what the Claude-Code entry parser understands, so
    // we serialize the transcript through this adapter first, then run the
    // generic text chunk-and-merge summarizer over it.
    const serialized = await piAdapter.serializeTranscript(sessionFile, {
      includeThinking: options?.includeThinking ?? true,
    });
    if (!serialized.trim()) {
      return { summary: '', summaryModel: null };
    }
    const summary = await summarizeSerializedText(serialized, {
      model: options?.model,
      richMode: options?.richMode ?? false,
      harness: options?.harness ?? 'claude-code',
      timeoutMs: options?.timeoutMs,
    });
    return { summary, summaryModel: options?.model ?? null };
  },
};

// ─── ACP ──────────────────────────────────────────────────────────────────

const ACP_TOOL_DETAIL_MAX_CHARS = 500;

function truncateAcpToolDetail(value: string): string {
  return value.length > ACP_TOOL_DETAIL_MAX_CHARS
    ? `${value.slice(0, ACP_TOOL_DETAIL_MAX_CHARS)}…`
    : value;
}

function serializeAcpToolCall(
  toolCall: Partial<AcpTranscriptToolCallState>,
): string | undefined {
  const name = toolCall.title?.trim() || toolCall.kind?.trim();
  if (!name) return undefined;

  const status = toolCall.status ? ` (${toolCall.status})` : '';
  const lines = [`[tool_use: ${name}${status}]`];
  if (toolCall.command?.trim()) {
    lines.push(`$ ${truncateAcpToolDetail(toolCall.command.trim())}`);
  }
  if (toolCall.detail?.trim()) {
    lines.push(truncateAcpToolDetail(toolCall.detail.trim()));
  }
  return lines.join('\n');
}

function serializeAcpEntry(entry: Partial<AcpTranscriptEntry>): string | undefined {
  if (
    entry.role !== 'user' &&
    entry.role !== 'assistant' &&
    entry.role !== 'tool' &&
    entry.role !== 'system'
  ) {
    return undefined;
  }

  const lines = [`[${entry.role}]`];
  if (typeof entry.content === 'string' && entry.content.trim()) {
    lines.push(entry.content);
  }
  if (Array.isArray(entry.toolCalls)) {
    for (const toolCall of entry.toolCalls) {
      if (!toolCall || typeof toolCall !== 'object') continue;
      const serialized = serializeAcpToolCall(toolCall);
      if (serialized) lines.push(serialized);
    }
  }
  return lines.length > 1 ? lines.join('\n') : undefined;
}

const acpAdapter: ConversationTranscriptAdapter = {
  name: 'acp',
  supportsPlainForkAsSource: false,
  supportsSourceAuthoredHandoff: false,

  async resolveSessionFile(conv) {
    const path = join(getOverdeckHome(), 'agents', conv.tmuxSession, 'acp-session.jsonl');
    return existsSync(path) ? path : null;
  },

  async serializeTranscript(sessionFile) {
    const content = await readFile(sessionFile, 'utf-8');
    const parts: string[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let entry: Partial<AcpTranscriptEntry>;
      try {
        entry = JSON.parse(line) as Partial<AcpTranscriptEntry>;
      } catch {
        continue;
      }
      const serialized = serializeAcpEntry(entry);
      if (serialized) parts.push(serialized);
    }
    return parts.join('\n\n');
  },

  async compactSummary(sessionFile, options) {
    const serialized = await acpAdapter.serializeTranscript(sessionFile);
    if (!serialized.trim()) {
      return { summary: '', summaryModel: null };
    }
    const summary = await summarizeSerializedText(serialized, {
      model: options?.model,
      richMode: options?.richMode ?? false,
      harness: options?.harness ?? 'claude-code',
      timeoutMs: options?.timeoutMs,
    });
    return { summary, summaryModel: options?.model ?? null };
  },
};

// ─── Kimi Code ────────────────────────────────────────────────────────────
//
// Kimi's native wire.jsonl is an event stream, not message-per-line like
// Claude/Pi — see kimi-parser.ts and kimi-conversation-parser.ts (the
// reviewed v1 chat-panel adapter) for the full shape. This serializer covers
// the same event set that adapter renders: turn.prompt (user), content.part
// text (assistant; 'think' parts are hidden reasoning, included only when
// includeThinking), and tool.call (work log). tool.result is intentionally
// skipped, matching the pi/acp adapters above.

/**
 * Resolve the native Kimi Code CLI wire.jsonl for a conversation. Mirrors
 * jsonl-resolver.ts's resolveKimiWirePath, reimplemented locally (rather than
 * imported) to avoid a circular import this module would otherwise close:
 * jsonl-resolver.js -> agents.js -> agents/resume.js ->
 * conversation-compaction.js -> summary-fork.js -> transcript-adapter.js.
 * Fast path: the captured `kimi-session-id` for this conversation's tmux
 * session maps directly to the wire.jsonl path; fallback (no captured id):
 * the newest session directory under the workspace's bucket.
 */
async function resolveKimiWireFileFromTmux(tmuxSession: string, workspace: string): Promise<string | null> {
  const kimiHome = join(homedir(), '.kimi-code');
  const sessionIdPath = join(getOverdeckHome(), 'agents', tmuxSession, 'kimi-session-id');
  const sessionId = await readFile(sessionIdPath, 'utf-8').then((s) => s.trim(), () => null);
  return findKimiWirePathAsync(kimiHome, workspace, sessionId);
}

interface KimiWireLoopEvent {
  type?: string;
  toolCallId?: string;
  name?: string;
  args?: unknown;
  part?: { type?: string; text?: string; think?: string };
  [k: string]: unknown;
}

interface KimiWireLine {
  type?: string;
  input?: Array<{ type?: string; text?: string }>;
  event?: KimiWireLoopEvent;
  [k: string]: unknown;
}

function extractKimiPromptText(input: KimiWireLine['input']): string {
  if (!Array.isArray(input)) return '';
  return input
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text!.trim())
    .filter(Boolean)
    .join('\n\n');
}

function serializeKimiEntry(entry: KimiWireLine, includeThinking: boolean): string | undefined {
  if (entry.type === 'turn.prompt') {
    const text = extractKimiPromptText(entry.input);
    return text ? `[user]\n${text}` : undefined;
  }

  if (entry.type !== 'context.append_loop_event' || !entry.event) return undefined;
  const event = entry.event;

  if (event.type === 'content.part' && event.part?.type === 'text' && event.part.text?.trim()) {
    return `[assistant]\n${event.part.text.trim()}`;
  }
  if (event.type === 'content.part' && event.part?.type === 'think' && includeThinking && event.part.think?.trim()) {
    return `[assistant]\n[thinking]\n${event.part.think.trim()}`;
  }
  if (event.type === 'tool.call' && typeof event.name === 'string') {
    let args = '';
    try {
      args = JSON.stringify(event.args).slice(0, 500);
    } catch {
      args = '<unserializable>';
    }
    return `[tool_use: ${event.name}]\n${args}`;
  }
  // tool.result, step.begin/end, usage.record, metadata: intentionally
  // skipped — same rationale as the pi/acp adapters above.
  return undefined;
}

const kimiCodeAdapter: ConversationTranscriptAdapter = {
  name: 'kimi-code',
  // Not the raw Claude JSONL a `claude --resume` can consume; Kimi has its
  // own native resume (`-S <id>`), a distinct code path from "plain fork".
  supportsPlainForkAsSource: false,
  // Conservative default matching acp/pi: source-authored handoff via
  // deliverAgentMessage + sentinel-file wait is unverified for kimi-code.
  supportsSourceAuthoredHandoff: false,

  async resolveSessionFile(conv) {
    return resolveKimiWireFileFromTmux(conv.tmuxSession, conv.cwd);
  },

  async serializeTranscript(sessionFile, options) {
    const includeThinking = options?.includeThinking ?? true;
    const content = await readFile(sessionFile, 'utf-8');
    const parts: string[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let entry: KimiWireLine;
      try {
        entry = JSON.parse(line) as KimiWireLine;
      } catch {
        continue;
      }
      const serialized = serializeKimiEntry(entry, includeThinking);
      if (serialized) parts.push(serialized);
    }
    return parts.join('\n\n');
  },

  async compactSummary(sessionFile, options) {
    // Kimi's wire.jsonl shape is not what the Claude-Code entry parser
    // understands, so serialize through this adapter first, then run the
    // generic text chunk-and-merge summarizer over it (same as pi/acp).
    const serialized = await kimiCodeAdapter.serializeTranscript(sessionFile, {
      includeThinking: options?.includeThinking ?? true,
    });
    if (!serialized.trim()) {
      return { summary: '', summaryModel: null };
    }
    const summary = await summarizeSerializedText(serialized, {
      model: options?.model,
      richMode: options?.richMode ?? false,
      harness: options?.harness ?? 'claude-code',
      timeoutMs: options?.timeoutMs,
    });
    return { summary, summaryModel: options?.model ?? null };
  },
};

// ─── Codex ───────────────────────────────────────────────────────────────

interface CodexRolloutPayload {
  type?: string;
  message?: string;
  name?: string;
  arguments?: string;
  input?: unknown;
}

interface CodexRolloutEntry {
  type?: string;
  payload?: CodexRolloutPayload;
}

function serializeCodexEntry(entry: CodexRolloutEntry): string | undefined {
  const payload = entry.payload;
  if (!payload) return undefined;

  if (entry.type === 'event_msg') {
    if (
      (payload.type === 'user_message' || payload.type === 'agent_message')
      && typeof payload.message === 'string'
    ) {
      const message = payload.message.trim();
      if (!message) return undefined;
      const role = payload.type === 'user_message' ? 'user' : 'assistant';
      return `[${role}]\n${message}`;
    }
    return undefined;
  }

  if (
    entry.type === 'response_item'
    && (payload.type === 'function_call' || payload.type === 'custom_tool_call')
    && typeof payload.name === 'string'
  ) {
    let args = '';
    if (typeof payload.arguments === 'string') {
      args = payload.arguments.slice(0, 500);
    } else {
      try {
        args = JSON.stringify(payload.input)?.slice(0, 500) ?? '';
      } catch {
        args = '<unserializable>';
      }
    }
    return `[tool_use: ${payload.name}]\n${args}`;
  }

  // session_meta, turn_context, token_count, tool outputs, raw response
  // messages, and encrypted reasoning are intentionally skipped. Codex never
  // exposes reasoning here, so includeThinking has no effect for this adapter.
  return undefined;
}

const codexAdapter: ConversationTranscriptAdapter = {
  name: 'codex',
  supportsPlainForkAsSource: false,
  supportsSourceAuthoredHandoff: true,

  async resolveSessionFile(conv) {
    return resolveCodexRolloutPath(conv.tmuxSession);
  },

  async serializeTranscript(sessionFile) {
    const content = await readFile(sessionFile, 'utf-8');
    const parts: string[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let entry: CodexRolloutEntry;
      try {
        entry = JSON.parse(line) as CodexRolloutEntry;
      } catch {
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      const serialized = serializeCodexEntry(entry);
      if (serialized) parts.push(serialized);
    }
    return parts.join('\n\n');
  },

  async compactSummary(sessionFile, options) {
    const serialized = await codexAdapter.serializeTranscript(sessionFile, {
      includeThinking: options?.includeThinking ?? true,
    });
    if (!serialized.trim()) {
      return { summary: '', summaryModel: null };
    }
    const summary = await summarizeSerializedText(serialized, {
      model: options?.model,
      richMode: options?.richMode ?? false,
      harness: options?.harness ?? 'claude-code',
      timeoutMs: options?.timeoutMs,
    });
    return { summary, summaryModel: options?.model ?? null };
  },
};

// ─── Registry ─────────────────────────────────────────────────────────────

const REGISTRY: Partial<Record<RuntimeName, ConversationTranscriptAdapter>> = {
  'claude-code': claudeCodeAdapter,
  'ohmypi': piAdapter,
  'codex': codexAdapter,
  'acp': acpAdapter,
  'kimi-code': kimiCodeAdapter,
  'prime-agent': primeAgentAdapter,
};

/**
 * Look up the transcript adapter for a harness. Unknown harnesses default to
 * the Claude Code adapter — that matches the conservative behavior of the rest
 * of the codebase (see getHarness() in @overdeck/contracts).
 */
export function getTranscriptAdapter(harness: RuntimeName | undefined): ConversationTranscriptAdapter {
  return REGISTRY[harness ?? 'claude-code'] ?? claudeCodeAdapter;
}
