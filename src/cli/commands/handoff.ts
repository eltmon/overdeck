import chalk from 'chalk';
import { existsSync } from 'fs';
import { getConversationById, getConversationByName } from '../../lib/database/conversations-db.js';
import { resolveCurrentConversation } from '../../lib/conversations/current.js';
import { forkConversationViaServer, ForkServerError } from './fork-client.js';
import { sessionFilePath } from '../../lib/paths.js';
import type { RuntimeName } from '../../lib/runtimes/types.js';

interface HandoffOptions {
  model?: string;
  harness?: string;
  cwd?: string;
  author?: string;
  authorModel?: string;
  authorHarness?: string;
}

function resolveConversation(convRef: string) {
  if (/^\d+$/.test(convRef)) {
    return getConversationById(parseInt(convRef, 10));
  }
  return getConversationByName(convRef);
}

const SELF_REFS = new Set(['self', '.', 'current', 'me']);

function validateHarness(harness: string | undefined): RuntimeName | undefined {
  if (harness === undefined || harness === 'claude-code' || harness === 'pi' || harness === 'codex') {
    return harness;
  }
  console.log(chalk.yellow(`Invalid harness: ${harness}. Expected claude-code, pi, or codex.`));
  process.exit(1);
}

export async function handoffCommand(
  convRef: string | undefined,
  focusArgs: string[],
  options: HandoffOptions,
): Promise<void> {
  // Self-detect when no conversation is given (or an explicit self-ref). This is
  // the deterministic answer to "hand off the conversation I'm in" — it replaces
  // the old scan-and-guess pattern that picked the wrong source (PAN-1520).
  const wantsSelf = convRef === undefined || SELF_REFS.has(convRef.toLowerCase());
  const conv = wantsSelf ? await resolveCurrentConversation() : resolveConversation(convRef);
  if (!conv) {
    if (wantsSelf) {
      console.log(chalk.yellow('Could not determine the current conversation.'));
      console.log(chalk.gray('  `pan handoff` with no <conv> only works from inside a conversation session.'));
      console.log(chalk.gray('  Pass an explicit conversation id or name, e.g. `pan handoff 371`.'));
    } else {
      console.log(chalk.yellow(`Conversation not found: ${convRef}`));
    }
    process.exit(1);
  }

  const sessionFile = conv.claudeSessionId ? sessionFilePath(conv.cwd, conv.claudeSessionId) : null;
  if (!sessionFile || !existsSync(sessionFile)) {
    console.log(chalk.yellow(`No session file found for conversation ${conv.name}`));
    process.exit(1);
  }

  const focus = focusArgs.join(' ').trim() || undefined;
  const harness = validateHarness(options.harness);
  const authorHarness = validateHarness(options.authorHarness);
  const author = options.author === 'source' ? 'source' : 'external';
  if (options.author !== undefined && options.author !== 'source' && options.author !== 'external') {
    console.log(chalk.yellow(`Invalid --author: ${options.author}. Expected source or external.`));
    process.exit(1);
  }
  console.log(chalk.gray(`Creating handoff from conversation: ${conv.name} (${conv.title || 'untitled'})`));
  console.log(chalk.gray(`  Author: ${author}${author === 'external' ? ` (model=${options.authorModel ?? 'default'}, harness=${authorHarness ?? 'claude-code'})` : ' (in-source agent)'}`));
  if (focus) {
    console.log(chalk.gray(`  Focus: ${focus}`));
  }
  console.log(chalk.gray('  Authoring the handoff and spawning the session — this can take a minute…'));

  // PAN-1568: route through the dashboard server, which authors the doc AND
  // spawns the tmux session. The old in-process path never spawned, so the
  // handoff was born dead.
  let newConv;
  try {
    newConv = await forkConversationViaServer(conv.name, {
      model: options.model,
      cwd: options.cwd,
      harness,
      forkMode: 'handoff',
      focus,
      handoffAuthor: author,
      handoffAuthorModel: options.authorModel,
      handoffAuthorHarness: authorHarness,
    });
  } catch (err) {
    if (err instanceof ForkServerError) {
      console.log(chalk.red(err.message));
      process.exit(1);
    }
    throw err;
  }

  if (newConv.forkStatus === 'failed') {
    console.log(chalk.red(`Handoff failed: ${newConv.forkError ?? 'unknown error'}`));
    console.log(chalk.gray(`  Conv ID: ${newConv.id} (Dashboard: https://pan.localhost/conv/${newConv.id})`));
    process.exit(1);
  }
  if (newConv.forkFallbackReason) {
    console.log(chalk.yellow(`Handoff fell back to summary fork: ${newConv.forkFallbackReason}`));
  }

  console.log(chalk.green(`Handoff forked conversation ${conv.name} → ${newConv.name}`));
  console.log(chalk.gray(`  Conv ID: ${newConv.id}`));
  console.log(chalk.gray(`  Session: ${newConv.tmuxSession}${newConv.sessionAlive ? ' (live)' : ''}`));
  console.log(chalk.gray(`  Model: ${newConv.model || 'default'}`));
  console.log(chalk.gray(`  Harness: ${newConv.harness || 'claude-code'}`));
  if (newConv.handoffDocPath) {
    console.log(chalk.gray(`  Handoff doc: ${newConv.handoffDocPath}`));
  }
  console.log(chalk.gray(`  Dashboard: https://pan.localhost/conv/${newConv.id}`));
}
