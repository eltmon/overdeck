/**
 * Single source of truth for the permission flags we pass to spawned Claude Code processes.
 *
 * Background: every Panopticon spawn site historically hardcoded
 * `--dangerously-skip-permissions --permission-mode bypassPermissions`. This module
 * centralizes that decision so the mode can be switched per-deployment via config or
 * per-invocation via the `--yolo` flag / `PAN_YOLO` env var.
 *
 * Override precedence (highest wins):
 *   1. PAN_YOLO env var ("1"/"true"/"yes" → bypass, "0"/"false"/"no" → auto)
 *   2. ClaudePermissionMode argument (callers that have already resolved CLI/env)
 *   3. config.claude.permissionMode in ~/.panopticon/config.yaml
 *   4. 'auto' (default — uses Claude Code's classifier instead of full bypass)
 *
 * `auto` mode requires `skipAutoPermissionPrompt: true` in ~/.claude/settings.json.
 * Switch to 'bypass' explicitly (config or `--yolo`) on providers that reject the
 * `auto` flag or when you need fully unmoderated execution.
 */

import type { ClaudePermissionMode } from './config.js';
import { loadConfig as loadYamlConfig } from './config-yaml.js';

const YOLO_TRUE = new Set(['1', 'true', 'yes', 'y', 'on']);
const YOLO_FALSE = new Set(['0', 'false', 'no', 'n', 'off']);

/**
 * The exact CLI flag string for "skip every permission prompt". This is the
 * ONLY place in the codebase the literal token should appear; the lint guard
 * (`scripts/lint-permissions.sh`) enforces that. Other modules that need to
 * test for, append, or message about this flag must import this constant.
 */
export const DSP_FLAG = '--dangerously-skip-permissions';
/** Matching --permission-mode value for {@link DSP_FLAG}. */
export const BYPASS_PERMISSION_MODE = 'bypassPermissions';

/** Read PAN_YOLO from the current process env. Returns the implied mode, or undefined if unset/unparseable. */
export function readYoloEnv(env: NodeJS.ProcessEnv = process.env): ClaudePermissionMode | undefined {
  const raw = env.PAN_YOLO;
  if (raw === undefined || raw === '') return undefined;
  const normalized = raw.trim().toLowerCase();
  if (YOLO_TRUE.has(normalized)) return 'bypass';
  if (YOLO_FALSE.has(normalized)) return 'auto';
  return undefined;
}

/**
 * Resolve the effective permission mode given an optional explicit override
 * (typically from the --yolo CLI flag, already converted to a ClaudePermissionMode).
 * PAN_YOLO env var takes precedence over the explicit override so a parent process
 * can force a mode for any child pan invocation.
 */
export function resolvePermissionMode(explicit?: ClaudePermissionMode): ClaudePermissionMode {
  const fromEnv = readYoloEnv();
  if (fromEnv) return fromEnv;
  if (explicit) return explicit;
  try {
    return loadYamlConfig().config.claude.permissionMode;
  } catch {
    return 'auto';
  }
}

/** Permission CLI flags as an argv-friendly array. */
export function getClaudePermissionFlags(mode?: ClaudePermissionMode): string[] {
  const resolved = mode ?? resolvePermissionMode();
  if (resolved === 'auto') {
    return ['--permission-mode', 'auto'];
  }
  return [DSP_FLAG, '--permission-mode', BYPASS_PERMISSION_MODE];
}

/** Permission CLI flags as a single space-joined string for shell-style command construction. */
export function getClaudePermissionFlagsString(mode?: ClaudePermissionMode): string {
  return getClaudePermissionFlags(mode).join(' ');
}

/**
 * Bypass prefix injected ahead of `--agent` when the resolved mode is `bypass`.
 *
 * `--agent` short-circuits the standalone permission flags (the agent's
 * frontmatter owns permissionMode), so callers that build command strings
 * with `--agent` need a separate, mode-aware way to add DSP. Centralizing
 * the literal here means `--dangerously-skip-permissions` only appears as
 * a string in this module — the lint guard (`scripts/lint-permissions.sh`)
 * relies on that property. Returns `' --dangerously-skip-permissions'`
 * (with leading space) when bypass, `''` otherwise.
 */
export function bypassPrefixForAgentFlag(mode?: ClaudePermissionMode): string {
  const resolved = mode ?? resolvePermissionMode();
  return resolved === 'bypass' ? ` ${DSP_FLAG}` : '';
}

/**
 * Shape of `~/.claude/settings.json` that Panopticon writes onto provisioned
 * Claude Code installations (local first-time setup AND remote Fly VMs).
 *
 * The `permissions.defaultMode` field is what `claude` falls back to when
 * a launch command does not pass `--permission-mode`. Hardcoding
 * `bypassPermissions` here is a latent escalation path: any unflagged
 * `claude` invocation on the host (interactive use, future scripts that
 * forget the flag) silently runs in bypass even when the user set Auto.
 *
 * Resolution must match the spawn-flag resolver so the settings file and
 * the CLI flags agree.
 */
export interface ClaudeUserSettings {
  theme: 'dark';
  permissions: { defaultMode: 'default' | 'bypassPermissions' };
}

/**
 * Build the `~/.claude/settings.json` payload for a provisioned host.
 *
 * - mode === 'auto'   → `defaultMode: 'default'` (Claude's classifier runs;
 *                       destructive ops still prompt for permission).
 * - mode === 'bypass' → `defaultMode: 'bypassPermissions'` (matches the
 *                       --dangerously-skip-permissions CLI flag).
 *
 * Pass an explicit `mode` when provisioning a remote host so the resolved
 * mode at provision time is captured deterministically. With no argument,
 * resolves from env/config like the CLI flag helpers.
 */
export function buildClaudeUserSettings(mode?: ClaudePermissionMode): ClaudeUserSettings {
  const resolved = mode ?? resolvePermissionMode();
  return {
    theme: 'dark',
    permissions: {
      defaultMode: resolved === 'bypass' ? 'bypassPermissions' : 'default',
    },
  };
}
