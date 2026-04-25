import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Conversation } from '../database/conversations-db.js';
import { createConversation } from '../database/conversations-db.js';
import { encodeClaudeProjectDir } from '../paths.js';
import { loadConfig } from '../config-yaml.js';
import { generateSmartSummary, runModelSummary } from './smart-compaction.js';

export interface SummaryForkOptions {
  model?: string;
  cwd?: string;
  localSummaryOnly?: boolean;
  /** When true, skip summary generation and copy the raw JSONL history
   *  (from the last compact_boundary, if any) into the new session file. */
  plain?: boolean;
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

export async function generateSummaryForFork(jsonlPath: string, summaryModel?: string): Promise<{ summary: string; summaryModel: string | null }> {
  if (!summaryModel) {
    // Fork summaries serialize the entire conversation in one shot. Sonnet 4.6's
    // 1M-token context handles large sessions that would overflow Haiku's 200k.
    summaryModel = 'claude-sonnet-4-6';
  }

  const { config } = loadConfig();
  const richMode = config.conversations.richCompaction;

  const result = await generateSmartSummary({ jsonlPath, model: summaryModel, richMode, mode: 'fork' });
  return { summary: result.summary + FORK_WAIT_INSTRUCTION, summaryModel };
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
 * Copy JSONL content from the last compact_boundary (or from the start)
 * into a new session file.
 */
export async function copySessionFromCompactBoundary(
  sourcePath: string,
  destPath: string,
): Promise<void> {
  const { readFile, writeFile } = await import('node:fs/promises');
  const boundaryOffset = await findLastCompactBoundaryOffset(sourcePath);
  const content = await readFile(sourcePath, 'utf-8');
  const sliced = boundaryOffset > 0 ? content.slice(boundaryOffset) : content;
  await writeFile(destPath, sliced, 'utf-8');
}

export async function createSummaryFork(
  conv: Conversation,
  options: SummaryForkOptions = {},
): Promise<SummaryForkResult> {
  if (!conv.sessionFile) {
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
    await copySessionFromCompactBoundary(conv.sessionFile, sessionFile);
    summary = '';
    usedSummaryModel = null;
  } else if (options.localSummaryOnly) {
    summary = await generateFallbackSummary(conv.sessionFile);
    usedSummaryModel = null;
  } else {
    const result = await generateSummaryForFork(conv.sessionFile, summaryModel ?? undefined);
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
    sessionFile,
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
