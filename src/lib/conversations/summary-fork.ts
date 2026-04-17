import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Conversation } from '../database/conversations-db.js';
import { createConversation } from '../database/conversations-db.js';
import { encodeClaudeProjectDir } from '../paths.js';

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

const SUMMARY_TIMEOUT_MS = 60_000;

const FORK_WAIT_INSTRUCTION = `\n---\n\n**Do not take any action.** This is context from a prior conversation fork. Acknowledge the summary and wait for the user's next instruction.`;

/**
 * Extract a summary from a Claude Code JSONL session file.
 * Returns a markdown summary string.
 */
export async function generateSummary(jsonlPath: string): Promise<string> {
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

function buildSummaryPrompt(transcript: string): string {
  return [
    'You are creating a continuation summary for a coding conversation fork.',
    'Summarize the prior conversation so a fresh coding session can continue without losing context.',
    'Focus on the user goal, key decisions, files changed, important tool findings, blockers, and what remains.',
    'Be concrete and concise. Use markdown with these sections when relevant:',
    '- Goal',
    '- Important context',
    '- Files changed',
    '- Open questions / risks',
    '- Next steps',
    '',
    'Transcript excerpt:',
    transcript,
  ].join('\n');
}

const DEFAULT_SUMMARY_MODEL = 'claude-haiku-4-5-20251001';

async function runModelSummary(prompt: string, model?: string): Promise<string> {
  const useModel = model || DEFAULT_SUMMARY_MODEL;
  const args = [
    '-p',
    '--model', useModel,
    '--dangerously-skip-permissions',
    '--permission-mode', 'bypassPermissions',
  ];

  const child = spawn('claude', args, {
    env: process.env as Record<string, string>,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  return await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Summary generation timed out after ${SUMMARY_TIMEOUT_MS}ms`));
    }, SUMMARY_TIMEOUT_MS);

    child.stdin.end(prompt);
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
        reject(new Error(`Summary generation failed: ${detail}`));
        return;
      }

      const summary = stdout.trim();
      if (!summary) {
        reject(new Error(`Summary generation returned empty output`));
        return;
      }
      resolve(summary);
    });
  });
}

export async function generateSummaryForFork(jsonlPath: string, summaryModel?: string): Promise<{ summary: string; summaryModel: string | null }> {
  const transcript = await readFile(jsonlPath, 'utf-8');

  if (!transcript.trim()) {
    throw new Error(`Session file is empty: ${jsonlPath}`);
  }

  const useModel = summaryModel || DEFAULT_SUMMARY_MODEL;
  const prompt = buildSummaryPrompt(transcript);
  try {
    const summary = await runModelSummary(prompt, useModel);
    return { summary: summary + FORK_WAIT_INSTRUCTION, summaryModel: useModel };
  } catch (error) {
    console.warn(`[summary-fork] Falling back to local summary for ${jsonlPath}:`, error);
    return { summary: await generateSummary(jsonlPath), summaryModel: null };
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
    ? { summary: await generateSummary(conv.sessionFile), summaryModel: null }
    : await generateSummaryForFork(conv.sessionFile);
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
