/**
 * Async streaming JSONL parser for the scanner service (PAN-457).
 *
 * Streams a Claude Code session JSONL file line-by-line via readline so
 * the file is never loaded fully into memory. PAN-1249: returns an Effect.
 *
 * The implementation still uses Node's `fs.createReadStream` + `readline`
 * because the Effect `FileSystem.stream` API yields raw byte chunks rather
 * than crlf-delimited lines and we'd have to re-implement line-splitting
 * around partial UTF-8 boundaries — readline already handles that.
 *
 * Errors are intentionally swallowed (partial metadata is preferable to a
 * scan-wide failure), so the public Effect's error channel is `never`.
 *
 * Do NOT modify the existing sync parsers in cost-parsers/jsonl-parser.ts —
 * they remain valid for CLI cost commands.
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { Effect } from 'effect';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Metadata extracted from a single Claude Code JSONL session file.
 */
export interface SessionMetadata {
  messageCount: number;
  firstTs: string | null;
  lastTs: string | null;
  modelsUsed: string[];
  primaryModel: string | null;
  tokenInput: number;
  tokenOutput: number;
  toolsUsed: string[];
  filesTouched: string[];
  /** sessionId extracted from the first message's top-level `sessionId` field */
  sessionId: string | null;
  /** cwd extracted from the first message's `cwd` field (set by Claude Code on first message) */
  cwdFromFirstMessage: string | null;
}

/**
 * A Claude Code JSONL line — extended for discovery purposes only.
 *
 * Real Claude Code transcripts (type=user/assistant) store content blocks in
 * message.content, not at the top level. Legacy/simplified fixtures may use
 * top-level content. We try message.content first, then fall back.
 */
interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeMessageWithCwd {
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  model?: string;
  /** top-level content (legacy fixture format) */
  content?: string | ContentBlock[];
  usage?: ClaudeUsage;
  message?: {
    role?: 'user' | 'assistant';
    model?: string;
    /** real transcript format: content blocks live here */
    content?: string | ContentBlock[];
    usage?: ClaudeUsage;
    [key: string]: unknown;
  };
}

interface ContentBlock {
  type: string;
  name?: string;
  input?: Record<string, unknown>;
}

// ─── File tools that produce file paths (excluding Bash) ─────────────────────

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'Glob']);

/**
 * Extract a file path from a tool_use input block.
 * Returns null if the tool is not a file tool or has no path.
 */
function extractFilePath(toolName: string, input: Record<string, unknown>): string | null {
  if (!FILE_TOOLS.has(toolName)) return null;
  // Most file tools use 'file_path' or 'path'
  const path = (input['file_path'] ?? input['path']) as string | undefined;
  return typeof path === 'string' && path.length > 0 ? path : null;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Asynchronously parse a Claude Code JSONL session file.
 *
 * Streams the file line-by-line using readline — never loads the full file.
 * On corrupt/empty/partial input, returns best-effort partial metadata. The
 * Effect cannot fail (error channel = `never`); IO errors yield whatever
 * was parsed up to the failure point.
 */
export function parseSessionJsonl(filePath: string): Effect.Effect<SessionMetadata, never> {
  return Effect.callback<SessionMetadata, never>((resume) => {
    const result: SessionMetadata = {
      messageCount: 0,
      firstTs: null,
      lastTs: null,
      modelsUsed: [],
      primaryModel: null,
      tokenInput: 0,
      tokenOutput: 0,
      toolsUsed: [],
      filesTouched: [],
      sessionId: null,
      cwdFromFirstMessage: null,
    };

    const modelCounts: Record<string, number> = {};
    const toolsSet = new Set<string>();
    const filesSet = new Set<string>();
    let isFirstMessage = true;
    let finalized = false;

    const readStream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: readStream, crlfDelay: Infinity });

    const finalize = () => {
      if (finalized) return;
      finalized = true;
      try {
        rl.close();
      } catch {
        // ignore
      }
      try {
        readStream.destroy();
      } catch {
        // ignore
      }

      result.modelsUsed = Object.keys(modelCounts);
      if (result.modelsUsed.length > 0) {
        result.primaryModel = result.modelsUsed.reduce((a, b) =>
          (modelCounts[a] ?? 0) >= (modelCounts[b] ?? 0) ? a : b,
        );
      }
      result.toolsUsed = [...toolsSet];
      result.filesTouched = [...filesSet];
      resume(Effect.succeed(result));
    };

    rl.on('line', (rawLine) => {
      const line = rawLine.trim();
      if (!line) return;

      let msg: ClaudeMessageWithCwd;
      try {
        msg = JSON.parse(line) as ClaudeMessageWithCwd;
      } catch {
        // Skip corrupt lines
        return;
      }

      result.messageCount++;

      // Extract sessionId and cwd from the first parseable message
      if (isFirstMessage) {
        isFirstMessage = false;
        if (typeof msg.sessionId === 'string' && msg.sessionId.length > 0) {
          result.sessionId = msg.sessionId;
        }
        if (typeof msg.cwd === 'string' && msg.cwd.length > 0) {
          result.cwdFromFirstMessage = msg.cwd;
        }
      }

      // Timestamps
      const ts = msg.timestamp ?? msg.message?.['timestamp' as keyof typeof msg.message];
      if (typeof ts === 'string' && ts.length > 0) {
        if (result.firstTs === null) result.firstTs = ts;
        result.lastTs = ts;
      }

      // Model
      const model = msg.message?.model ?? msg.model;
      if (typeof model === 'string' && model.length > 0) {
        modelCounts[model] = (modelCounts[model] ?? 0) + 1;
      }

      // Token usage — check message.usage first, then top-level usage
      const usage = msg.message?.usage ?? msg.usage;
      if (usage) {
        result.tokenInput += (usage.input_tokens ?? 0)
          + (usage.cache_creation_input_tokens ?? 0)
          + (usage.cache_read_input_tokens ?? 0);
        result.tokenOutput += usage.output_tokens ?? 0;
      }

      // Tool usage from content blocks.
      // Real transcripts store blocks in message.content; legacy fixtures use top-level content.
      const contentBlocks = msg.message?.content ?? msg.content;
      if (Array.isArray(contentBlocks)) {
        for (const block of contentBlocks as ContentBlock[]) {
          if (block.type === 'tool_use' && typeof block.name === 'string') {
            toolsSet.add(block.name);
            const filePath_ = block.input
              ? extractFilePath(block.name, block.input)
              : null;
            if (filePath_) filesSet.add(filePath_);
          }
        }
      }
    });

    rl.on('close', finalize);
    rl.on('error', finalize);
    readStream.on('error', finalize);
  });
}
