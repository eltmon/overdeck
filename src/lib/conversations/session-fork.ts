/**
 * PAN-1862 (NFR-3): the reusable session-fork primitive.
 *
 * Forking a Claude Code session = copy its JSONL transcript to a freshly
 * reserved session id and relaunch with `claude --resume <newId>`. Because
 * Anthropic's prompt cache is content-addressed (a hash of the prefix for a
 * given model, NOT the session id), a byte-identical copied history resumed
 * under a new id hits the same cache entries the source session wrote.
 *
 * Extracted from the conversation-panel fork machinery (summary-fork.ts) so the
 * conversation panel AND the review convoy share ONE copy/reserve code path —
 * no copy-paste fork logic (repo "No Bandaids" rule). Two consumers:
 *
 *  - Conversation forks (summary-fork.ts): copy from the last compact boundary
 *    (the summarized tail is what the fork continues from).
 *  - Review convoy forks (review-agent.ts): copy the FULL history — the parent's
 *    discovery reads are exactly the payload the forked reviewers must inherit.
 *
 * The source JSONL is sacred and strictly read-only here (CLAUDE.md).
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeClaudeProjectDir } from '../paths.js';

export interface ReservedForkSession {
  sessionId: string;
  sessionFile: string;
}

/** Reserve a fresh session id + JSONL path under the cwd's Claude project dir. */
export async function reserveForkSession(cwd: string): Promise<ReservedForkSession> {
  const sessionId = randomUUID();
  const encodedDir = encodeClaudeProjectDir(cwd);
  const sessionsDir = join(process.env.HOME ?? '', '.claude', 'projects', encodedDir);
  await mkdir(sessionsDir, { recursive: true });
  return { sessionId, sessionFile: join(sessionsDir, `${sessionId}.jsonl`) };
}

/**
 * Find the byte offset of the last `compact_boundary` entry in a JSONL file.
 * Returns 0 if no boundary is found.
 */
export async function findLastCompactBoundaryOffset(jsonlPath: string): Promise<number> {
  const content = await readFile(jsonlPath, 'utf-8');
  const lines = content.split('\n');
  let offset = 0;
  let lastBoundaryOffset = 0;
  for (const line of lines) {
    if (line.trim()) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
          lastBoundaryOffset = offset;
        }
      } catch { /* skip invalid lines */ }
    }
    offset += line.length + 1; // +1 for \n
  }
  return lastBoundaryOffset;
}

/**
 * Sanitize assistant entries by converting thinking blocks to plain text.
 * This prevents API errors when resuming a session cross-model/provider,
 * since thinking block signatures are bound to the original API request.
 */
type JsonlEntry = {
  type?: string;
  message?: { content?: Array<Record<string, unknown>> };
  [key: string]: unknown;
};

export function sanitizeEntryForPlainFork(entry: JsonlEntry): JsonlEntry {
  if (entry.type !== 'assistant' || !entry.message || !Array.isArray(entry.message.content)) {
    return entry;
  }

  const sanitizedContent = entry.message.content.map((block: Record<string, unknown>) => {
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      // Convert thinking block to text block so the new model doesn't
      // attempt to validate a signature bound to a different API request.
      return {
        type: 'text',
        text: `[Thinking]\n${block.thinking}`,
      };
    }
    return block;
  });

  return {
    ...entry,
    message: {
      ...entry.message,
      content: sanitizedContent,
    },
  };
}

/**
 * Copy a session JSONL to `destPath` for a fork.
 *
 * `fullHistory: false` (conversation-fork behavior) slices from the last
 * compact boundary; `true` (review-convoy behavior) copies everything —
 * the discovery context is the payload. Thinking blocks are sanitized in
 * both modes. The source file is never modified.
 */
export async function copySessionForFork(
  sourcePath: string,
  destPath: string,
  opts: { fullHistory?: boolean } = {},
): Promise<void> {
  const boundaryOffset = opts.fullHistory ? 0 : await findLastCompactBoundaryOffset(sourcePath);
  const content = await readFile(sourcePath, 'utf-8');
  const sliced = boundaryOffset > 0 ? content.slice(boundaryOffset) : content;

  // Sanitize each line to strip thinking signatures
  const sanitizedLines = sliced.split('\n').map((line) => {
    if (!line.trim()) return line;
    try {
      const entry = JSON.parse(line);
      const sanitized = sanitizeEntryForPlainFork(entry);
      return JSON.stringify(sanitized);
    } catch {
      // Keep malformed lines as-is
      return line;
    }
  });

  await writeFile(destPath, sanitizedLines.join('\n'), 'utf-8');
}
