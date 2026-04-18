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
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { NormalizedCavemanConfig } from '../config-yaml.js';
import { getCavemanHooksDir } from './setup.js';

/** Caveman variant for A/B testing and cost tracking */
export type CavemanVariant = 'enabled' | 'disabled' | 'off';

const CAVEMAN_VARIANT_FILE = '.caveman-variant';

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
  /** Narrow type for a single Claude settings hook entry */
  type HookEntry = { hooks: Array<{ type: string; command: string; timeout?: number }> };

  let settings: Record<string, unknown> = {};

  // Load existing settings.json if it exists (deep merge)
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
    } catch {
      // Unparseable — start fresh
      settings = {};
    }
  }

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
