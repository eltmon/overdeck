import { Effect } from 'effect';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { getConversationById, getConversationByName } from '../../lib/database/conversations-db.js';
import { createSummaryFork } from '../../lib/conversations/summary-fork.js';
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

function validateHarness(harness: string | undefined): RuntimeName | undefined {
  if (harness === undefined || harness === 'claude-code' || harness === 'pi') {
    return harness;
  }
  console.log(chalk.yellow(`Invalid harness: ${harness}. Expected claude-code or pi.`));
  process.exit(1);
}

export async function handoffCommand(
  convRef: string,
  focusArgs: string[],
  options: HandoffOptions,
): Promise<void> {
  const conv = resolveConversation(convRef);
  if (!conv) {
    console.log(chalk.yellow(`Conversation not found: ${convRef}`));
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

  const result = await Effect.runPromise(createSummaryFork(conv, {
    model: options.model,
    cwd: options.cwd,
    harness,
    forkMode: 'handoff',
    focus,
    handoffAuthor: author,
    handoffAuthorModel: options.authorModel,
    handoffAuthorHarness: authorHarness,
  }));
  const newConv = result.conversation;

  if (result.forkFallbackReason) {
    console.log(chalk.yellow(`Handoff fell back to summary fork: ${result.forkFallbackReason}`));
  }

  const label = result.forkMode === 'handoff' ? 'Handoff forked' : 'Summary forked';
  console.log(chalk.green(`${label} conversation ${conv.name} → ${newConv.name}`));
  console.log(chalk.gray(`  Conv ID: ${newConv.id}`));
  console.log(chalk.gray(`  Session: ${newConv.tmuxSession}`));
  console.log(chalk.gray(`  Model: ${newConv.model || 'default'}`));
  console.log(chalk.gray(`  Harness: ${newConv.harness || 'claude-code'}`));
  if (newConv.handoffDocPath) {
    console.log(chalk.gray(`  Handoff doc: ${newConv.handoffDocPath}`));
  }
  console.log(chalk.gray(`  Dashboard: https://pan.localhost/conv/${newConv.id}`));
}
