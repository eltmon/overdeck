/**
 * Async streaming JSONL parser for the scanner service (PAN-457).
 *
 * Uses fs/promises + readline to parse a Claude Code session JSONL file
 * without loading the entire file into memory. Zero sync FS calls.
 *
 * Do NOT modify the existing sync parsers in cost-parsers/jsonl-parser.ts —
 * they remain valid for CLI cost commands.
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { ClaudeMessage } from '../cost-parsers/jsonl-parser.js';

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
  /** cwd extracted from the first message's `cwd` field (not part of ClaudeMessage spec — set by Claude Code) */
  cwdFromFirstMessage: string | null;
}

/**
 * A Claude Code JSONL line can include a `cwd` field on the first message.
 * This is an extended type for discovery purposes only.
 */
interface ClaudeMessageWithCwd extends ClaudeMessage {
  sessionId?: string;
  cwd?: string;
  /** content can be a string or array of content blocks */
  content?: string | ContentBlock[];
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
 * On corrupt/empty/partial input, returns best-effort partial metadata.
 */
export async function parseSessionJsonl(filePath: string): Promise<SessionMetadata> {
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

  let readStream: ReturnType<typeof createReadStream> | null = null;

  try {
    readStream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: readStream, crlfDelay: Infinity });

    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (!line) continue;

      let msg: ClaudeMessageWithCwd;
      try {
        msg = JSON.parse(line) as ClaudeMessageWithCwd;
      } catch {
        // Skip corrupt lines
        continue;
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
        result.tokenInput += usage.input_tokens ?? 0;
        result.tokenOutput += usage.output_tokens ?? 0;
      }

      // Tool usage from content blocks
      if (Array.isArray(msg.content)) {
        for (const block of msg.content as ContentBlock[]) {
          if (block.type === 'tool_use' && typeof block.name === 'string') {
            toolsSet.add(block.name);
            const filePath_ = block.input
              ? extractFilePath(block.name, block.input)
              : null;
            if (filePath_) filesSet.add(filePath_);
          }
        }
      }
    }
  } catch {
    // File read or stream error — return partial metadata
  } finally {
    readStream?.destroy();
  }

  // Build modelsUsed list and pick primaryModel (most frequent)
  result.modelsUsed = Object.keys(modelCounts);
  if (result.modelsUsed.length > 0) {
    result.primaryModel = result.modelsUsed.reduce((a, b) =>
      (modelCounts[a] ?? 0) >= (modelCounts[b] ?? 0) ? a : b,
    );
  }

  result.toolsUsed = [...toolsSet];
  result.filesTouched = [...filesSet];

  return result;
}
