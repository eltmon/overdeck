/** PAN-4185: per-conversation context opt-outs and the launcher env they set. */
import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { RuntimeName } from '../runtimes/types.js';

/**
 * Read from the conversation row so every (re)launch path — create, resume,
 * restart, fork — keeps them.
 */
export interface ConversationLaunchContext {
  /** Skip every Overdeck-injected layer: launch bundle, session briefing, memory hooks. */
  bareContext?: boolean;
  /** Claude Code only: skip native CLAUDE.md and auto-memory loading. */
  skipClaudeMd?: boolean;
  /** PAN-4486: per-conversation skill on/off map; the launch-settings step rereads it from the row. */
  skillOverrides?: Record<string, boolean> | null;
}
/** The launch context a stored conversation row (a `LegacyConversation`) carries. */
export function conversationLaunchContext(conv: {
  bareContext: boolean;
  skipClaudeMd: boolean;
  skillOverrides: Record<string, boolean> | null;
}): ConversationLaunchContext {
  return { bareContext: conv.bareContext === true, skipClaudeMd: conv.skipClaudeMd === true, skillOverrides: conv.skillOverrides ?? null };
}
/** PAN-4486: decode `conversations.skill_overrides`; null for null, invalid JSON or a non-object, boolean entries only. */
export function parseSkillOverridesColumn(raw: string | null): Record<string, boolean> | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
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
