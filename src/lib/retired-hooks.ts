/**
 * Migration for hook scripts Overdeck used to ship and has removed (PAN-4429).
 *
 * TLDR's Read hook (`tldr-read-enforcer`) and its PostToolUse partner
 * (`tldr-post-edit`) are gone from sync-sources/hooks/. An existing install
 * still has them registered in ~/.claude/settings.json and copied into
 * ~/.overdeck/bin/, and workspace-local `.claude/settings.json` copies (made by
 * copyOverdeckSettingsToWorkspace) carry the same entries. Deleting the script
 * while its registration survives makes Claude Code report "not found" on every
 * Read, so the order is fixed: unregister first, then delete the bin files.
 *
 * Settings writes follow the PAN-1137 guarantees: an unparseable file is never
 * rewritten, and the global settings.json is backed up and written atomically.
 * Never depends on jq or python3.
 */

import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { atomicWriteJson, backupSettings, pruneBackups } from './claude-settings-file.js';
import { BIN_DIR } from './paths.js';
import { listProjectsSync } from './projects.js';

/** Hook scripts Overdeck used to ship and now removes from existing installs (PAN-4429). */
export const RETIRED_HOOK_SCRIPT_NAMES = ['tldr-read-enforcer', 'tldr-post-edit'] as const;

/**
 * The slice of a Claude Code settings.json this module reads. Structural, so
 * ClaudeSettings from claude-hooks-registration.ts satisfies it without this
 * module importing that one (which imports this one).
 */
interface HookGroup {
  hooks?: Array<{ command?: string }>;
}

export interface HookSettings {
  hooks?: { [hookType: string]: HookGroup[] | undefined };
}

export interface RetireResult {
  /** `<HookType>:<name>` labels removed from the global settings.json. */
  unregistered: string[];
  /** Bin-dir files deleted. */
  deletedBins: string[];
  /** Whether the global mcp.json `tldr` server entry was removed. */
  mcpRemoved: boolean;
  /** Checkout-local settings/mcp files rewritten by the sweep. */
  checkoutFilesUpdated: string[];
  /** Set when the global settings.json could not be parsed (left untouched). */
  warning?: string;
}

function retiredNameIn(command: string | undefined, binDir: string): string | undefined {
  if (!command) return undefined;
  return RETIRED_HOOK_SCRIPT_NAMES.find(
    (name) => command.includes(join(binDir, name)) || command.includes(`overdeck/bin/${name}`),
  );
}

/**
 * Pure: drop every settings.json hook entry whose command references a retired
 * script, in either `<binDir>/<name>` or literal `overdeck/bin/<name>` form.
 * Mutates `settings`; returns `<HookType>:<name>` labels removed. Drops a
 * matcher group only when all of its hooks were retired (same rule as
 * pruneLegacyPanopticonHook).
 */
export function pruneRetiredOverdeckHooks(settings: HookSettings, binDir: string): string[] {
  const removed: string[] = [];
  const hooks = settings?.hooks;
  if (!hooks) return removed;

  for (const hookType of Object.keys(hooks)) {
    const list: HookGroup[] | undefined = hooks[hookType];
    if (!Array.isArray(list)) continue;

    let changed = false;
    const next: HookGroup[] = [];
    for (const group of list) {
      const originalHooks = group.hooks ?? [];
      const keptHooks = originalHooks.filter((hook) => {
        const name = retiredNameIn(hook.command, binDir);
        if (!name) return true;
        removed.push(`${hookType}:${name}`);
        changed = true;
        return false;
      });
      if (keptHooks.length > 0 || originalHooks.length === 0) {
        next.push(keptHooks.length === originalHooks.length ? group : { ...group, hooks: keptHooks });
      }
    }
    if (changed) hooks[hookType] = next;
  }
  return removed;
}

/**
 * Pure: remove `mcpServers.tldr` when its command ends with `tldr-mcp` (the
 * entry `pan admin hooks install` used to write). Returns true if removed.
 */
export function pruneTldrMcpServer(mcpConfig: { mcpServers?: Record<string, { command?: string } | undefined> }): boolean {
  const server = mcpConfig?.mcpServers?.tldr;
  if (!server || typeof server.command !== 'string' || !server.command.endsWith('tldr-mcp')) return false;
  delete mcpConfig.mcpServers!.tldr;
  return true;
}

/** Each registered project root (listProjectsSync) plus every directory in <root>/workspaces/. */
export function listCandidateCheckouts(projects = listProjectsSync()): string[] {
  const checkouts: string[] = [];
  for (const { config } of projects) {
    const root = config.path;
    if (!root || !existsSync(root)) continue;
    checkouts.push(root);
    const workspacesDir = join(root, 'workspaces');
    let entries: string[];
    try {
      entries = readdirSync(workspacesDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = join(workspacesDir, entry);
      try {
        if (statSync(dir).isDirectory()) checkouts.push(dir);
      } catch {
        // vanished between readdir and stat
      }
    }
  }
  return checkouts;
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Prune retired entries from one checkout's local Claude files; returns the files rewritten. */
function sweepCheckout(checkout: string, binDir: string): string[] {
  const updated: string[] = [];
  const claudeDir = join(checkout, '.claude');
  for (const name of ['settings.json', 'settings.local.json']) {
    const path = join(claudeDir, name);
    if (!existsSync(path)) continue;
    const settings = readJson(path);
    if (!settings) continue;
    if (pruneRetiredOverdeckHooks(settings as HookSettings, binDir).length > 0) {
      atomicWriteJson(path, settings);
      updated.push(path);
    }
  }
  const mcpPath = join(claudeDir, 'mcp.json');
  if (existsSync(mcpPath)) {
    const mcpConfig = readJson(mcpPath);
    if (mcpConfig && pruneTldrMcpServer(mcpConfig)) {
      atomicWriteJson(mcpPath, mcpConfig);
      updated.push(mcpPath);
    }
  }
  return updated;
}

/**
 * Migration for pan sync / pan install. Order: read settings.json → prune →
 * backup + atomic write (only if changed) → sweep checkout-local copies →
 * delete `<binDir>/<name>` for each retired name → remove mcp.json
 * `mcpServers.tldr` when its command ends with `tldr-mcp`.
 */
export async function retireTldrHooks(
  opts: { settingsPath?: string; binDir?: string; mcpPath?: string; checkouts?: string[] } = {},
): Promise<RetireResult> {
  const result: RetireResult = { unregistered: [], deletedBins: [], mcpRemoved: false, checkoutFilesUpdated: [] };

  // Under a test runner the defaults resolve to the developer's real
  // ~/.claude files; tests that exercise this pass explicit paths.
  if (!opts.settingsPath && process.env.VITEST) return result;

  const settingsPath = opts.settingsPath ?? join(homedir(), '.claude', 'settings.json');
  const binDir = opts.binDir ?? BIN_DIR;
  const mcpPath = opts.mcpPath ?? join(homedir(), '.claude', 'mcp.json');

  if (existsSync(settingsPath)) {
    let settings: HookSettings | undefined;
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as HookSettings;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.warning = `${settingsPath} is not valid JSON (${msg}); retired TLDR hook entries were not removed from it`;
    }
    if (settings) {
      result.unregistered = pruneRetiredOverdeckHooks(settings, binDir);
      if (result.unregistered.length > 0) {
        backupSettings(settingsPath);
        atomicWriteJson(settingsPath, settings);
        pruneBackups(settingsPath);
      }
    }
  }

  for (const checkout of opts.checkouts ?? listCandidateCheckouts()) {
    result.checkoutFilesUpdated.push(...sweepCheckout(checkout, binDir));
  }

  // Claude Code loads no hooks from an invalid settings.json, so the bin files
  // go even when the unregister above was skipped.
  for (const name of RETIRED_HOOK_SCRIPT_NAMES) {
    const binPath = join(binDir, name);
    if (!existsSync(binPath)) continue;
    try {
      unlinkSync(binPath);
      result.deletedBins.push(binPath);
    } catch {
      // best-effort; the next sync retries
    }
  }

  if (existsSync(mcpPath)) {
    const mcpConfig = readJson(mcpPath);
    if (mcpConfig && pruneTldrMcpServer(mcpConfig)) {
      atomicWriteJson(mcpPath, mcpConfig);
      result.mcpRemoved = true;
    }
  }

  return result;
}
