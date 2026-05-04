/**
 * Conversation fork pipeline.
 *
 * This module handles creating a new conversation from an existing one.
 * Two modes are supported:
 *
 * 1. Summary fork (default): The conversation history is serialized and sent
 *    to an LLM summarizer (see smart-compaction.ts). The generated structured
 *    summary is injected as the first user message in the new session.
 *
 * 2. Plain fork: Raw JSONL history is copied from the last compact_boundary
 *    into a new session file. Thinking blocks are sanitized (converted to text)
 *    to prevent signature validation errors on cross-model resumes.
 *
 * Entry point: createSummaryFork()
 * - Reserves a new session ID and file path
 * - Generates summary (LLM, heuristic fallback, or skips for plain fork)
 * - Creates a DB record for the new conversation
 * - Returns the new conversation + session metadata
 *
 * Dashboard API: runForkPipeline() in src/dashboard/server/routes/conversations.ts
 * wires the options through and handles tmux spawn + summary injection.
 */
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Conversation } from '../database/conversations-db.js';
import { createConversation } from '../database/conversations-db.js';
import { encodeClaudeProjectDir, sessionFilePath } from '../paths.js';
import { loadConfig } from '../config-yaml.js';
import { generateSmartSummary, runModelSummary } from './smart-compaction.js';

export interface SummaryForkOptions {
  model?: string;
  cwd?: string;
  localSummaryOnly?: boolean;
  /** When true, skip summary generation and copy the raw JSONL history
   *  (from the last compact_boundary, if any) into the new session file. */
  plain?: boolean;
  /** When true, include thinking block content in the serialized conversation sent to the summary model. Default: true. */
  includeThinkingInSummary?: boolean;
}

export interface SummaryForkResult {
  conversation: Conversation;
  sessionId: string;
  sessionFile: string;
  summary: string;
  summaryModel: string | null;
}

const FORK_WAIT_INSTRUCTION = `\n---\n\n**Do not take any action.** This is context from a prior conversation fork. Acknowledge the summary and wait for the user's next instruction.`;

/**
 * Generate a heuristic fallback summary without calling an LLM.
 * Used only when smart summary fails and we need a last-resort fallback.
 */
export async function generateFallbackSummary(jsonlPath: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const lines = (await readFile(jsonlPath, 'utf-8'))
    .split('\n')
    .filter((l) => l.trim());

  const userMessages: string[] = [];
  const filesModified = new Set<string>();
  const toolsUsed = new Set<string>();

  for (const line of lines) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === 'user' && entry.message) {
      const content = entry.message.content;
      if (typeof content === 'string' && content.trim()) {
        if (!content.trim().startsWith('<local-command') && !content.trim().startsWith('<command-name')) {
          userMessages.push(content.trim());
        }
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text?.trim() && !block.text.trim().startsWith('<')) {
            userMessages.push(block.text.trim());
          }
        }
      }
    }

    if (entry.type === 'assistant' && entry.message?.content) {
      const content = entry.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use') {
            toolsUsed.add(block.name);
            if (block.name === 'Edit' || block.name === 'Write') {
              const fp = block.input?.file_path || block.input?.path;
              if (fp) filesModified.add(fp);
            }
          }
        }
      }
    }
  }

  let summary = `## Conversation Summary Fork\n\n`;
  summary += `This is a continuation of a previous conversation, seeded with a summary of the earlier work.\n\n`;

  if (userMessages.length > 0) {
    summary += `### User Messages:\n`;
    for (const msg of userMessages.slice(0, 10)) {
      summary += `- ${msg.slice(0, 200)}${msg.length > 200 ? '...' : ''}\n`;
    }
    summary += '\n';
  }

  if (filesModified.size > 0) {
    summary += `### Files Modified:\n`;
    for (const f of [...filesModified].sort()) {
      summary += `- \`${f.replace(/.*\/panopticon-cli\//, '')}\`\n`;
    }
    summary += '\n';
  }

  if (toolsUsed.size > 0) {
    summary += `### Tools Used: ${[...toolsUsed].sort().join(', ')}\n\n`;
  }

  summary += FORK_WAIT_INSTRUCTION;

  return summary;
}

export async function generateSummaryForFork(jsonlPath: string, summaryModel?: string, includeThinkingInSummary?: boolean): Promise<{ summary: string; summaryModel: string | null }> {
  if (!summaryModel) {
    // Fork summaries serialize the entire conversation in one shot. Sonnet 4.6's
    // 1M-token context handles large sessions that would overflow Haiku's 200k.
    summaryModel = 'claude-sonnet-4-6';
  }

  console.log(`[claude-invoke] purpose=summary-fork | model=${summaryModel} | source=summary-fork.ts:generateSummaryForFork | jsonl=${jsonlPath}`);

  const { config } = loadConfig();
  const richMode = config.conversations.richCompaction;

  try {
    const result = await generateSmartSummary({ jsonlPath, model: summaryModel, richMode, mode: 'fork', includeThinkingInSummary });
    console.log(`[claude-invoke] SUCCESS purpose=summary-fork | model=${summaryModel} | outputChars=${result.summary.length}`);
    return { summary: result.summary + FORK_WAIT_INSTRUCTION, summaryModel };
  } catch (err: any) {
    console.error(`[claude-invoke] FAILED purpose=summary-fork | model=${summaryModel} | error="${err.message}"`);
    throw err;
  }
}

export async function reserveSummaryForkSession(
  cwd: string,
): Promise<{ sessionId: string; sessionFile: string }> {
  const sessionId = randomUUID();
  const encodedDir = encodeClaudeProjectDir(cwd);
  const sessionsDir = join(process.env.HOME ?? '', '.claude', 'projects', encodedDir);

  await mkdir(sessionsDir, { recursive: true });

  return {
    sessionId,
    sessionFile: join(sessionsDir, `${sessionId}.jsonl`),
  };
}

/**
 * Find the byte offset of the last `compact_boundary` entry in a JSONL file.
 * Returns 0 if no boundary is found.
 */
async function findLastCompactBoundaryOffset(jsonlPath: string): Promise<number> {
  const { readFile } = await import('node:fs/promises');
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
    offset += Buffer.byteLength(line, 'utf-8') + 1; // +1 for \n
  }
  return lastBoundaryOffset;
}

/**
 * Sanitize assistant entries by converting thinking blocks to plain text.
 * This prevents API errors when resuming a session cross-model/provider,
 * since thinking block signatures are bound to the original API request.
 */
function sanitizeEntryForPlainFork(entry: any): any {
  if (entry.type !== 'assistant' || !entry.message || !Array.isArray(entry.message.content)) {
    return entry;
  }

  const sanitizedContent = entry.message.content.map((block: any) => {
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
 * Copy JSONL content from the last compact_boundary (or from the start)
 * into a new session file. Thinking blocks are sanitized to prevent
 * signature validation errors on cross-model forks.
 */
export async function copySessionFromCompactBoundary(
  sourcePath: string,
  destPath: string,
): Promise<void> {
  const { readFile, writeFile } = await import('node:fs/promises');
  const boundaryOffset = await findLastCompactBoundaryOffset(sourcePath);
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

export async function createSummaryFork(
  conv: Conversation,
  options: SummaryForkOptions = {},
): Promise<SummaryForkResult> {
  const sourceSessionFile = conv.claudeSessionId
    ? sessionFilePath(conv.cwd, conv.claudeSessionId)
    : null;
  if (!sourceSessionFile) {
    throw new Error(`No session file found for conversation ${conv.name}`);
  }

  const cwd = options.cwd || conv.cwd || process.cwd();
  const launchModel = options.model || conv.model;
  const summaryModel = options.model || conv.model;
  console.log(`[summary-fork] Forking conv=${conv.name} launchModel=${launchModel || 'default'} summaryModel=${summaryModel || 'default'} localOnly=${options.localSummaryOnly || false} plain=${options.plain || false}`);

  const { sessionId, sessionFile } = await reserveSummaryForkSession(cwd);

  let summary: string;
  let usedSummaryModel: string | null;

  if (options.plain) {
    // Plain fork: copy raw JSONL from last compact boundary (or full history)
    // into the new session file so Claude Code can --resume it directly.
    await copySessionFromCompactBoundary(sourceSessionFile, sessionFile);
    summary = '';
    usedSummaryModel = null;
  } else if (options.localSummaryOnly) {
    summary = await generateFallbackSummary(sourceSessionFile);
    usedSummaryModel = null;
  } else {
    const result = await generateSummaryForFork(sourceSessionFile, summaryModel ?? undefined, options.includeThinkingInSummary);
    summary = result.summary;
    usedSummaryModel = result.summaryModel;
  }

  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomUUID().slice(0, 4);
  const newName = `${timestamp}-${suffix}`;
  const newTmux = `conv-${newName}`;

  const newConv = createConversation({
    name: newName,
    tmuxSession: newTmux,
    cwd,
    issueId: conv.issueId ?? undefined,
    title: options.plain
      ? `Fork: ${conv.title || conv.name}`
      : `Summary Fork: ${conv.title || conv.name}`,
    titleSource: 'manual',
    titleSeed: options.plain
      ? `Fork of ${conv.name}`
      : `Summary Fork of ${conv.name}`,
    claudeSessionId: sessionId,
    model: launchModel ?? undefined,
    effort: conv.effort ?? undefined,
  });

  return {
    conversation: newConv,
    sessionId,
    sessionFile,
    summary,
    summaryModel: usedSummaryModel,
  };
}

// Re-export runModelSummary for any callers that need it directly
export { runModelSummary };
