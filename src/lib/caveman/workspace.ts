/**
 * Caveman Workspace Settings Injection
 *
 * Injects caveman SessionStart + UserPromptSubmit hooks into a workspace's
 * .claude/settings.json at workspace creation time.
 *
 * Each workspace gets its own settings.json (not the global ~/.claude/settings.json)
 * so A/B test variants can be assigned per-workspace.
 *
 * The variant ("enabled" | "disabled" | "off") is stored in
 * <workspace>/.claude/.caveman-variant for later reading by agent spawn.
 */

import { existsSync } from 'fs';
import { chmod, mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { Effect } from 'effect';
import type { NormalizedCavemanConfig } from '../config-yaml.js';
import { FsError } from '../errors.js';
import { getCavemanHooksDir } from './setup.js';

/** Caveman variant for A/B testing and cost tracking */
export type CavemanVariant = 'enabled' | 'disabled' | 'off';

const CAVEMAN_VARIANT_FILE = '.caveman-variant';
const MEMORY_HOOK_SCRIPT = 'panopticon-memory-hook.js';

type HookEntry = { matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }> };

/**
 * Determine whether caveman is active for a given workspace and return the variant.
 *
 * - If caveman disabled globally → 'off'
 * - If ab_test: true → random 50/50 → 'enabled' or 'disabled'
 * - Otherwise → 'enabled'
 */
export function determineCavemanVariant(config: NormalizedCavemanConfig): CavemanVariant {
  if (!config.enabled) return 'off';
  if (config.abTest) {
    return Math.random() < 0.5 ? 'enabled' : 'disabled';
  }
  return 'enabled';
}

/**
 * Inject caveman hooks into a workspace's .claude/settings.json.
 *
 * Does a deep merge on the hooks key so that existing hooks (e.g. from
 * settings.local.json or project templates) are not overwritten.
 *
 * Also writes the variant file for later reading by agent spawn code.
 *
 * @param workspacePath  Absolute path to the workspace directory
 * @param variant        Pre-determined variant (call determineCavemanVariant first)
 */
export async function injectMemoryHookSettings(workspacePath: string): Promise<void> {
  const claudeDir = join(workspacePath, '.claude');
  await mkdir(claudeDir, { recursive: true });

  const scriptPath = await installTrustedMemoryHookScript();

  const settingsPath = join(claudeDir, 'settings.json');
  const settings = await readWorkspaceSettings(settingsPath);
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  settings.hooks = hooks;

  upsertHook(hooks, 'Stop', `node "${scriptPath}" turn`, 1);
  upsertHook(hooks, 'SessionStart', `node "${scriptPath}" session-start`, 1);
  upsertHook(hooks, 'UserPromptSubmit', `node "${scriptPath}" prompt-inject`, 2);

  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

export async function injectCavemanSettings(workspacePath: string, variant: CavemanVariant): Promise<void> {
  const claudeDir = join(workspacePath, '.claude');
  await mkdir(claudeDir, { recursive: true });

  // Write the variant file (read by spawnAgent to set PANOPTICON_CAVEMAN_VARIANT)
  await writeFile(join(claudeDir, CAVEMAN_VARIANT_FILE), variant, 'utf-8');

  // If caveman is off or disabled for this workspace, no hook injection needed
  if (variant !== 'enabled') return;

  const hooksDir = getCavemanHooksDir();
  const activateScript = join(hooksDir, 'panopticon-caveman-activate.js');
  const modeTrackerScript = join(hooksDir, 'caveman-mode-tracker.js');

  // If hooks aren't installed yet (pan admin hooks install not run), skip injection
  // and warn — workspace will work without caveman compression
  if (!existsSync(activateScript)) {
    console.warn(
      `⚠ Caveman hook files not found at ${hooksDir}. ` +
      `Run 'pan admin hooks install' to install them, then recreate the workspace.`
    );
    return;
  }

  const settingsPath = join(claudeDir, 'settings.json');
  const settings = await readWorkspaceSettings(settingsPath);
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  settings.hooks = hooks;

  // Inject SessionStart hook (caveman activation)
  if (!hooks.SessionStart) hooks.SessionStart = [];
  const sessionStartHook: HookEntry = {
    hooks: [{ type: 'command', command: `node "${activateScript}"`, timeout: 5 }],
  };
  // Dedup by command string (stable, key-ordering-independent)
  if (!hooks.SessionStart.some(h => h.hooks?.[0]?.command === `node "${activateScript}"`)) {
    hooks.SessionStart.push(sessionStartHook);
  }

  // Inject UserPromptSubmit hook (mode tracking for /caveman commands)
  if (!hooks.UserPromptSubmit) hooks.UserPromptSubmit = [];
  const userPromptHook: HookEntry = {
    hooks: [{ type: 'command', command: `node "${modeTrackerScript}"`, timeout: 5 }],
  };
  // Dedup by command string (stable, key-ordering-independent)
  if (!hooks.UserPromptSubmit.some(h => h.hooks?.[0]?.command === `node "${modeTrackerScript}"`)) {
    hooks.UserPromptSubmit.push(userPromptHook);
  }

  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

async function readWorkspaceSettings(settingsPath: string): Promise<Record<string, unknown>> {
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(await readFile(settingsPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function installTrustedMemoryHookScript(): Promise<string> {
  const hooksDir = join(process.env.PANOPTICON_HOME || join(homedir(), '.panopticon'), 'hooks', 'memory');
  await mkdir(hooksDir, { recursive: true, mode: 0o700 });
  await chmod(hooksDir, 0o700);
  const scriptPath = join(hooksDir, MEMORY_HOOK_SCRIPT);
  await writeFile(scriptPath, memoryHookScript(), { encoding: 'utf-8', mode: 0o600 });
  await chmod(scriptPath, 0o600);
  return scriptPath;
}

function upsertHook(hooks: Record<string, HookEntry[]>, hookType: string, command: string, timeout: number): void {
  const list = (hooks[hookType] ??= []);
  if (list.some((entry) => entry.hooks?.some((hook) => hook.command === command))) return;
  list.push({ matcher: '.*', hooks: [{ type: 'command', command, timeout }] });
}

function memoryHookScript(): string {
  return `#!/usr/bin/env node
const { existsSync, readFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');
const endpoint = process.argv[2];
const baseUrl = process.env.PANOPTICON_DASHBOARD_URL || 'http://localhost:3011';
const chunks = [];
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', async () => {
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  let input;
  try { input = JSON.parse(raw); } catch { input = {}; }
  try {
    if (endpoint === 'turn') {
      await post('/api/memory/turn', input, 500);
      return;
    }
    if (endpoint === 'session-start') {
      await post('/api/memory/session/start', input, 500);
      return;
    }
    if (endpoint === 'prompt-inject') {
      const response = await post('/api/memory/inject', {
        prompt: input.prompt || input.message || input.input || '',
        sessionId: input.session_id || input.sessionId || '',
        agentId: input.agent_id || input.agentId,
        identity: input.identity,
      }, 1000);
      const json = await response.json().catch(() => null);
      if (json && json.ok === true && typeof json.context === 'string' && json.context.length > 0) {
        process.stdout.write(json.context + '\\n');
      }
    }
  } catch {}
});
async function post(path, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-panopticon-internal-token': internalToken() },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
function internalToken() {
  if (process.env.PANOPTICON_INTERNAL_TOKEN) return process.env.PANOPTICON_INTERNAL_TOKEN;
  const path = join(process.env.PANOPTICON_HOME || join(homedir(), '.panopticon'), 'internal-token');
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8').trim();
}
`;
}

/**
 * Read the caveman variant stored in a workspace's .claude/.caveman-variant file.
 * Returns 'off' if the file doesn't exist (caveman was disabled at workspace creation).
 */
export async function readCavemanVariant(workspacePath: string): Promise<CavemanVariant> {
  const variantFile = join(workspacePath, '.claude', CAVEMAN_VARIANT_FILE);
  if (!existsSync(variantFile)) return 'off';
  const content = (await readFile(variantFile, 'utf-8')).trim();
  if (content === 'enabled' || content === 'disabled' || content === 'off') {
    return content;
  }
  return 'off';
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Additive Effect-channel variants. Sync callers keep working; new Effect-based
// composers can chain without round-tripping through `Effect.tryPromise`.

/** Effect variant of `injectCavemanSettings`. */
export const injectCavemanSettingsEffect = (
  workspacePath: string,
  variant: CavemanVariant,
): Effect.Effect<void, FsError> =>
  Effect.tryPromise({
    try: () => injectCavemanSettings(workspacePath, variant),
    catch: (cause) =>
      new FsError({
        path: workspacePath,
        operation: 'injectCavemanSettings',
        cause,
      }),
  });

/** Effect variant of `readCavemanVariant`. */
export const readCavemanVariantEffect = (
  workspacePath: string,
): Effect.Effect<CavemanVariant, FsError> =>
  Effect.tryPromise({
    try: () => readCavemanVariant(workspacePath),
    catch: (cause) =>
      new FsError({
        path: workspacePath,
        operation: 'readCavemanVariant',
        cause,
      }),
  });
