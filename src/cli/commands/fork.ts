import chalk from 'chalk';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import {
  createConversation,
  markConversationEnded,
  getConversationById,
  getConversationByName,
} from '../../lib/database/conversations-db.js';

interface ForkOptions {
  model?: string;
  cwd?: string;
}

/**
 * Extract a summary from a Claude Code JSONL session file.
 * Returns a markdown summary string.
 */
function generateSummary(jsonlPath: string): string {
  const lines = readFileSync(jsonlPath, 'utf-8')
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

  let summary = `## Conversation Summary (Forked)\n\n`;
  summary += `This is a continuation of a previous conversation that hit the context limit.\n\n`;

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
function createForkedJsonl(summary: string): { sessionId: string; sessionFile: string } {
  const sessionId = randomUUID();

  // Find the project directory for the session file
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const encodedDir = projectDir.replace(/\//g, '-');
  const sessionsDir = `${process.env.HOME}/.claude/projects/${encodedDir}`;

  const sessionFile = `${sessionsDir}/${sessionId}.jsonl`;
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

  writeFileSync(sessionFile, lines.join('\n') + '\n');

  return { sessionId, sessionFile };
}

export async function forkCommand(
  convRef: string,
  options: ForkOptions,
): Promise<void> {
  // Resolve conversation by ID (numeric) or name
  let conv: any = null;
  if (/^\d+$/.test(convRef)) {
    conv = getConversationById(parseInt(convRef, 10));
  } else {
    conv = getConversationByName(convRef);
  }

  if (!conv) {
    console.log(chalk.yellow(`Conversation not found: ${convRef}`));
    process.exit(1);
  }

  if (!conv.sessionFile || !existsSync(conv.sessionFile)) {
    console.log(chalk.yellow(`No session file found for conversation ${conv.name}`));
    process.exit(1);
  }

  console.log(chalk.gray(`Forking conversation: ${conv.name} (${conv.title || 'untitled'})`));

  // Generate summary
  const summary = generateSummary(conv.sessionFile);

  // Create new JSONL
  const { sessionId, sessionFile } = createForkedJsonl(summary);

  // Generate new conversation name
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomUUID().slice(0, 4);
  const newName = `${timestamp}-${suffix}`;
  const newTmux = `conv-${newName}`;
  const cwd = options.cwd || conv.cwd || process.cwd();
  const model = options.model || conv.model;

  // Create new conversation in DB
  const newConv = createConversation({
    name: newName,
    tmuxSession: newTmux,
    cwd,
    title: `Fork: ${conv.title || conv.name}`,
    titleSource: 'manual',
    titleSeed: `Fork of ${conv.name}`,
    sessionFile,
    model: model ?? undefined,
    effort: conv.effort ?? undefined,
  });

  // End old conversation
  markConversationEnded(conv.name);

  // Kill old tmux session
  try {
    execSync(`tmux kill-session -t ${conv.tmuxSession} 2>/dev/null`, { stdio: 'pipe' });
  } catch {
    // Session may not exist
  }

  // Start new tmux session
  try {
    execSync(`tmux new-session -d -s ${newTmux} -c ${cwd}`, { stdio: 'pipe' });
  } catch (err: any) {
    console.log(chalk.yellow(`Failed to create tmux session: ${err.message}`));
    console.log(chalk.gray(`Run manually: tmux new-session -d -s ${newTmux} -c ${cwd}`));
  }

  // Launch Claude Code in the new session
  const modelFlag = model ? ` --model ${model}` : '';
  try {
    execSync(
      `tmux send-keys -t ${newTmux} 'claude --session-id ${sessionId}${modelFlag} --permission-mode bypassPermissions' Enter`,
      { stdio: 'pipe' },
    );
  } catch (err: any) {
    console.log(chalk.yellow(`Failed to start Claude Code: ${err.message}`));
  }

  console.log(chalk.green(`Forked conversation ${conv.name} → ${newName}`));
  console.log(chalk.gray(`  Conv ID: ${newConv.id}`));
  console.log(chalk.gray(`  Session: ${newTmux}`));
  console.log(chalk.gray(`  Model: ${model || 'default'}`));
  console.log(chalk.gray(`  Dashboard: https://pan.localhost/conv/${newConv.id}`));
}
