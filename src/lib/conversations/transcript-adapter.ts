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
 * - Future harnesses (Codex, etc.) will have their own shapes.
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
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Effect } from 'effect';

import type { LegacyConversation as Conversation } from '../overdeck/conversations.js';
import type { RuntimeName } from '../runtimes/types.js';
import { sessionFilePath } from '../paths.js';
import {
  parseEntries as parseClaudeCodeEntries,
  serializeConversation as serializeClaudeCodeConversation,
  generateSmartSummary,
  summarizeSerializedText,
} from './smart-compaction.js';

export interface CompactSummaryOptions {
  /** Model for the summarizer LLM. */
  model?: string;
  /** Use the rich (Claude-native-style) summary prompt variant. */
  richMode?: boolean;
  /** Include thinking blocks in the serialized source. Default: true. */
  includeThinking?: boolean;
  /** Harness backend the summarizer LLM runs on. Default: 'claude-code'. */
  harness?: RuntimeName;
  /** Per-LLM-call timeout (ms). */
  timeoutMs?: number;
}

export interface ConversationTranscriptAdapter {
  /** Display name for logging/errors. */
  readonly name: RuntimeName;

  /** Plain forks copy raw Claude JSONL and spawn Claude with `--resume` —
   * only Claude Code can be the source of a plain fork. */
  readonly supportsPlainForkAsSource: boolean;

  /** Source-authored handoff requires delivering a prompt to the live source
   * agent and waiting for it to write a sentinel file. Claude Code supports
   * this via deliverAgentMessage; Pi has no hook-equivalent signaling channel
   * for the .done sentinel (see PAN-1134), so source authoring is gated off
   * for Pi until that lands. */
  readonly supportsSourceAuthoredHandoff: boolean;

  /** Resolve the path to the source conversation's transcript file.
   * Returns null if the conversation has no transcript yet (e.g. session
   * just started and hasn't produced a JSONL line). */
  resolveSessionFile(conv: Conversation): Promise<string | null>;

  /** Serialize the transcript into a harness-agnostic canonical text that
   * the handoff prompt template can embed verbatim. Each turn is rendered
   * with a `[user]` / `[assistant]` header followed by text and tool-use
   * summaries; thinking blocks are optional (defaults to including them).
   */
  serializeTranscript(sessionFile: string, options?: { includeThinking?: boolean }): Promise<string>;

  /**
   * Produce a model-generated compact summary of the transcript, suitable for
   * seeding a summary fork or feeding the handoff authoring prompt.
   *
   * claude-code uses the entry-aware smart-compaction flow (rich, file-op
   * aware); other harnesses serialize the transcript and run a generic
   * chunk-and-merge summarizer over the text. The `harness` option selects the
   * summarizer LLM backend and is independent of which adapter (= source
   * harness) produced the transcript.
   */
  compactSummary(
    sessionFile: string,
    options?: CompactSummaryOptions,
  ): Promise<{ summary: string; summaryModel: string | null }>;
}

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
  const sessionDir = join(homedir(), '.overdeck', 'agents', tmuxSession, 'sessions');
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

// ─── Registry ─────────────────────────────────────────────────────────────

const REGISTRY: Record<RuntimeName, ConversationTranscriptAdapter> = {
  'claude-code': claudeCodeAdapter,
  'ohmypi': piAdapter,
  'codex': claudeCodeAdapter,
};

/**
 * Look up the transcript adapter for a harness. Unknown harnesses default to
 * the Claude Code adapter — that matches the conservative behavior of the rest
 * of the codebase (see getHarness() in @overdeck/contracts).
 */
export function getTranscriptAdapter(harness: RuntimeName | undefined): ConversationTranscriptAdapter {
  return REGISTRY[harness ?? 'claude-code'] ?? claudeCodeAdapter;
}
