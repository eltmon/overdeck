import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Conversation } from '../database/conversations-db.js';
import { createConversation, markConversationEnded } from '../database/conversations-db.js';
import { encodeClaudeProjectDir } from '../paths.js';
import { createSessionAsync, killSessionAsync, sendKeysAsync } from '../tmux.js';

export interface SummaryForkOptions {
  model?: string;
  cwd?: string;
}

interface SummaryForkResult {
  conversation: Conversation;
  sessionId: string;
  sessionFile: string;
}

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
        // Skip system injections and commands
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

  summary += `### Remaining work:\n`;
  summary += `- Verify the changes are complete with \`npm run build\` and \`npm test\`\n`;
  summary += `- Review and commit the changes\n`;

  return summary;
}

/**
 * Create a new JSONL file with the summary as the first user message.
 * Returns the new session ID.
 */
export async function createSummaryForkJsonl(
  summary: string,
  cwd: string,
): Promise<{ sessionId: string; sessionFile: string }> {
  const sessionId = randomUUID();
  const encodedDir = encodeClaudeProjectDir(cwd);
  const sessionsDir = join(process.env.HOME ?? '', '.claude', 'projects', encodedDir);

  await mkdir(sessionsDir, { recursive: true });

  const sessionFile = join(sessionsDir, `${sessionId}.jsonl`);
  const now = new Date().toISOString();

  const lines = [
    JSON.stringify({
      type: 'permission-mode',
      permissionMode: 'bypassPermissions',
      sessionId,
    }),
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: summary,
      },
      uuid: randomUUID(),
      timestamp: now,
    }),
  ];

  await mkdir(dirname(sessionFile), { recursive: true });
  await writeFile(sessionFile, lines.join('\n') + '\n');

  return { sessionId, sessionFile };
}

export async function createSummaryFork(
  conv: Conversation,
  options: SummaryForkOptions = {},
): Promise<SummaryForkResult> {
  if (!conv.sessionFile) {
    throw new Error(`No session file found for conversation ${conv.name}`);
  }

  const cwd = options.cwd || conv.cwd || process.cwd();
  const model = options.model || conv.model;
  const summary = await generateSummary(conv.sessionFile);
  const { sessionId, sessionFile } = await createSummaryForkJsonl(summary, cwd);

  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomUUID().slice(0, 4);
  const newName = `${timestamp}-${suffix}`;
  const newTmux = `conv-${newName}`;

  const newConv = createConversation({
    name: newName,
    tmuxSession: newTmux,
    cwd,
    title: `Summary Fork: ${conv.title || conv.name}`,
    titleSource: 'manual',
    titleSeed: `Summary Fork of ${conv.name}`,
    sessionFile,
    model: model ?? undefined,
    effort: conv.effort ?? undefined,
  });

  markConversationEnded(conv.name);

  await killSessionAsync(conv.tmuxSession).catch(() => {});
  await createSessionAsync(newTmux, cwd);

  const modelFlag = model ? ` --model ${model}` : '';
  await sendKeysAsync(
    newTmux,
    `claude --session-id ${sessionId}${modelFlag} --permission-mode bypassPermissions`,
    'summary-fork',
  );

  return {
    conversation: newConv,
    sessionId,
    sessionFile,
  };
}
