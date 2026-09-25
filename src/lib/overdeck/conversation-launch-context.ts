/** PAN-4185: per-conversation context opt-outs and the launcher env they set. */
import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { RuntimeName } from '../runtimes/types.js';
import type { LegacyConversation } from './conversations.js';

/**
 * Read from the conversation row so every (re)launch path — create, resume,
 * restart, fork — keeps them.
 */
export interface ConversationLaunchContext {
  /** Skip every Overdeck-injected layer: launch bundle, session briefing, memory hooks. */
  bareContext?: boolean;
  /** Claude Code only: skip native CLAUDE.md and auto-memory loading. */
  skipClaudeMd?: boolean;
}
/** The launch context a stored conversation row carries. */
export function conversationLaunchContext(conv: Pick<LegacyConversation, 'bareContext' | 'skipClaudeMd'>): ConversationLaunchContext {
  return { bareContext: conv.bareContext === true, skipClaudeMd: conv.skipClaudeMd === true };
}
/** Launcher exports for a conversation's context opt-outs. */
export function conversationContextEnvExports(launchContext: ConversationLaunchContext, harness: RuntimeName): string[] {
  const exports: string[] = [];
  // The injecting hooks (session-start, user-prompt-submit) check this and skip
  // their memory/briefing injection; observing work in the same hooks still runs.
  if (launchContext.bareContext) exports.push('export OVERDECK_BARE_CONTEXT=1');
  // Documented Claude Code switches (code.claude.com/docs/en/env-vars). Unlike
  // --bare/--safe-mode they leave settings hooks alone, so the observing hooks
  // (ready signal, transcript capture, activity) keep working.
  if (launchContext.skipClaudeMd && getHarnessBehavior(harness).transcriptKind === 'claude-jsonl') {
    exports.push('export CLAUDE_CODE_DISABLE_CLAUDE_MDS=1', 'export CLAUDE_CODE_DISABLE_AUTO_MEMORY=1');
  }
  return exports;
}
