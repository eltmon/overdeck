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
  return ['--dangerously-skip-permissions', '--permission-mode', 'bypassPermissions'];
}

/** Permission CLI flags as a single space-joined string for shell-style command construction. */
export function getClaudePermissionFlagsString(mode?: ClaudePermissionMode): string {
  return getClaudePermissionFlags(mode).join(' ');
}
