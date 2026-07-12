/**
 * Overdeck's Claude Code hook registration — single source of truth for
 * WHICH hook scripts exist and WHERE they register in ~/.claude/settings.json.
 *
 * Consumed by two installers that must never drift:
 *   - `pan admin hooks install` (src/cli/commands/setup/hooks.ts) — the
 *     interactive CLI path.
 *   - the desktop boot provisioner (src/lib/claude-hooks-provision.ts) — the
 *     non-interactive path for machines that never run the pan CLI (PAN-2595).
 *
 * Registration is delta-only: existing entries (including hand-customized
 * matchers) are left alone; only missing Overdeck hooks are appended, and
 * stale pre-rebrand `panopticon/bin` twins are pruned (PAN-2530).
 */

import { join } from 'path';

export interface HookConfig {
  matcher: string; // Regex pattern, e.g. ".*" for all tools or "Bash" for specific
  hooks: Array<{
    type: string;
    command: string;
  }>;
}

interface McpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ClaudeSettings {
  hooks?: {
    PreToolUse?: HookConfig[];
    PostToolUse?: HookConfig[];
    Stop?: HookConfig[];
    SessionStart?: HookConfig[];
    Notification?: HookConfig[];
    PreCompact?: HookConfig[];
    PostCompact?: HookConfig[];
    UserPromptSubmit?: HookConfig[];
    PermissionRequest?: HookConfig[];
  };
  mcpServers?: Record<string, McpServer>;
  // Unknown top-level keys (statusLine, theme, …) must survive read→write
  // untouched.
  [key: string]: unknown;
}

export type HookType = keyof NonNullable<ClaudeSettings['hooks']>;

/**
 * Hook scripts copied from sync-sources/hooks/ to ~/.overdeck/bin/.
 * (Comments preserved from the original setupHooksCommand list.)
 */
export const HOOK_SCRIPT_NAMES: readonly string[] = [
  'pan-hook-lib.sh',        // PAN-800: shared library sourced by all hooks
  'pre-tool-hook',
  'ask-user-question-hook',
  'auto-approve-hook',
  'heartbeat-hook',
  'stop-hook',
  'notification-hook',      // PAN-800: Notification — emits agent.waiting_started
  'specialist-stop-hook',
  'work-agent-stop-hook',   // PAN-800: chained from stop-hook; emits agent.resolution_changed
  'session-start-hook',          // PAN-800: SessionStart — emits agent.activity_changed(idle) + agent.model_set
  'user-prompt-submit-hook',     // UserPromptSubmit — clears waiting state, records message_received, restarts spinner
  'pre-compact-hook',            // PreCompact — emits activity=working/compact so dashboard shows compacting indicator
  'post-compact-hook',           // PostCompact — emits activity=idle to clear compacting state
  'record-cost-event.js',
  'gh-issue-trailer-hook',
  'gh-issue-trailer-hook.js',
  'tldr-read-enforcer',
  'tldr-post-edit',
  'rtk-bash-filter',
  'permission-event-hook',   // PermissionRequest — emits conversation.permission_changed(waiting)
  'tmux-send-keys-guard',    // PAN-1084: blocks work agents from driving other agents' tmux sessions
];

export interface HookRegistration {
  hookType: HookType;
  scriptName: string;
  matcher?: string;
  /** TLDR hooks only make sense when python3 exists on the machine. */
  requiresPython3?: boolean;
}

/**
 * The settings.json registration table. Order matters only for readability;
 * see setupHooksCommand for the per-entry rationale comments (PAN-1402,
 * PAN-1024, PAN-1084, PAN-1520).
 */
export const OVERDECK_HOOK_REGISTRATIONS: readonly HookRegistration[] = [
  { hookType: 'PreToolUse', scriptName: 'pre-tool-hook' },
  { hookType: 'PreToolUse', scriptName: 'auto-approve-hook' },
  { hookType: 'PreToolUse', scriptName: 'gh-issue-trailer-hook', matcher: 'Bash' },
  { hookType: 'PreToolUse', scriptName: 'tmux-send-keys-guard', matcher: 'Bash' },
  { hookType: 'PreToolUse', scriptName: 'ask-user-question-hook', matcher: 'AskUserQuestion' },
  { hookType: 'PostToolUse', scriptName: 'heartbeat-hook' },
  { hookType: 'PostToolUse', scriptName: 'permission-event-hook' },
  { hookType: 'Stop', scriptName: 'stop-hook' },
  { hookType: 'Stop', scriptName: 'permission-event-hook' },
  { hookType: 'SessionStart', scriptName: 'session-start-hook' },
  { hookType: 'Notification', scriptName: 'notification-hook' },
  { hookType: 'UserPromptSubmit', scriptName: 'user-prompt-submit-hook' },
  { hookType: 'PreCompact', scriptName: 'pre-compact-hook' },
  { hookType: 'PostCompact', scriptName: 'post-compact-hook' },
  { hookType: 'PermissionRequest', scriptName: 'permission-event-hook' },
  { hookType: 'PreToolUse', scriptName: 'tldr-read-enforcer', matcher: 'Read', requiresPython3: true },
  { hookType: 'PostToolUse', scriptName: 'tldr-post-edit', matcher: 'Edit|Write', requiresPython3: true },
];

/**
 * Per-hook-type detection of whether a Overdeck hook is already registered.
 * PAN-800: rewritten from an all-or-nothing short-circuit to a delta-install
 * check so users with older installs still get SessionStart/Notification/etc.
 * added without having to wipe their settings.
 */
function isHookConfigured(
  settings: ClaudeSettings,
  hookType: HookType,
  binDir: string,
  scriptName: string,
): boolean {
  const hooks = settings?.hooks?.[hookType] || [];
  return hooks.some((hookConfig: HookConfig) =>
    hookConfig.hooks?.some((hook: { type: string; command: string }) =>
      (hook.command?.includes(join(binDir, scriptName)) ?? false) ||
      (hook.command?.includes(`overdeck/bin/${scriptName}`) ?? false)
    )
  );
}

/**
 * PAN-2530: Remove stale pre-rebrand hook entries that point at the old
 * `~/.panopticon/bin/<scriptName>` path.
 *
 * Before the PAN-1952 rebrand, hooks were installed under `panopticon/bin/`.
 * `isHookConfigured()` only recognizes the current `overdeck/bin/` path, so a
 * re-sync after the rename added the new hook *alongside* the legacy one,
 * leaving both registered and both firing (e.g. ask-user-question-hook fired
 * twice, one copy still branded "Panopticon"). Prune any legacy entry for this
 * script so exactly one hook survives after install.
 *
 * Mutates `settings` in place. Returns true if anything was removed.
 */
export function pruneLegacyPanopticonHook(
  settings: ClaudeSettings,
  hookType: HookType,
  scriptName: string,
): boolean {
  const list = settings?.hooks?.[hookType];
  if (!list) return false;

  const isLegacy = (command: string | undefined): boolean =>
    command?.includes(`panopticon/bin/${scriptName}`) ?? false;

  let removed = false;
  const next: HookConfig[] = [];
  for (const hookConfig of list) {
    const originalHooks = hookConfig.hooks ?? [];
    const keptHooks = originalHooks.filter((hook) => {
      if (isLegacy(hook.command)) {
        removed = true;
        return false;
      }
      return true;
    });
    // Drop a config only if it *had* hooks and they were all legacy; otherwise
    // preserve it (including genuinely-empty configs) unchanged.
    if (keptHooks.length > 0 || originalHooks.length === 0) {
      next.push(keptHooks.length === originalHooks.length ? hookConfig : { ...hookConfig, hooks: keptHooks });
    }
  }

  if (removed) {
    settings.hooks![hookType] = next;
  }
  return removed;
}

export function addOverdeckHookIfMissing(
  settings: ClaudeSettings,
  hookType: HookType,
  binDir: string,
  scriptName: string,
  matcher: string = '.*',
): boolean {
  if (!settings.hooks) {
    settings.hooks = {};
  }
  // PAN-2530: drop any stale panopticon/bin/<scriptName> twin so the rebrand
  // never leaves two copies of this hook registered and firing together.
  pruneLegacyPanopticonHook(settings, hookType, scriptName);
  if (isHookConfigured(settings, hookType, binDir, scriptName)) return false;
  const list = (settings.hooks[hookType] ??= []);
  list.push({
    matcher,
    hooks: [{ type: 'command', command: join(binDir, scriptName) }],
  });
  return true;
}

/**
 * Apply the full Overdeck registration table to `settings` (mutated in place,
 * delta-only). Returns what changed so callers can decide whether to write.
 */
export function applyOverdeckHookRegistrations(
  settings: ClaudeSettings,
  binDir: string,
  opts: { python3Available: boolean },
): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const reg of OVERDECK_HOOK_REGISTRATIONS) {
    if (reg.requiresPython3 && !opts.python3Available) continue;
    if (pruneLegacyPanopticonHook(settings, reg.hookType, reg.scriptName)) {
      removed.push(`${reg.hookType}:${reg.scriptName}`);
    }
    if (addOverdeckHookIfMissing(settings, reg.hookType, binDir, reg.scriptName, reg.matcher ?? '.*')) {
      added.push(`${reg.hookType}:${reg.scriptName}`);
    }
  }
  return { added, removed };
}
