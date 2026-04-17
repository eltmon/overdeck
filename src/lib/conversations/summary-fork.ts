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
    // Default to haiku for cost-effective summarization
    summaryModel = 'claude-haiku-4-5-20251001';
  }

  const { config } = loadConfig();
  const richMode = config.conversations.richCompaction;

  try {
    const result = await generateSmartSummary({ jsonlPath, model: summaryModel, richMode });
    return { summary: result.summary + FORK_WAIT_INSTRUCTION, summaryModel };
  } catch (error) {
    console.warn(`[summary-fork] Smart summary failed for ${jsonlPath}:`, error);
    // Final fallback: heuristic extraction
    return { summary: await generateFallbackSummary(jsonlPath), summaryModel: null };
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

export async function createSummaryFork(
  conv: Conversation,
  options: SummaryForkOptions = {},
): Promise<SummaryForkResult> {
  if (!conv.sessionFile) {
    throw new Error(`No session file found for conversation ${conv.name}`);
  }

  const cwd = options.cwd || conv.cwd || process.cwd();
  const launchModel = options.model || conv.model;
  const { summary, summaryModel: usedSummaryModel } = options.localSummaryOnly
    ? { summary: await generateFallbackSummary(conv.sessionFile), summaryModel: null }
    : await generateSummaryForFork(conv.sessionFile, options.model);
  const { sessionId, sessionFile } = await reserveSummaryForkSession(cwd);

  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomUUID().slice(0, 4);
  const newName = `${timestamp}-${suffix}`;
  const newTmux = `conv-${newName}`;

  const newConv = createConversation({
    name: newName,
    tmuxSession: newTmux,
    cwd,
    issueId: conv.issueId ?? undefined,
    title: `Summary Fork: ${conv.title || conv.name}`,
    titleSource: 'manual',
    titleSeed: `Summary Fork of ${conv.name}`,
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
