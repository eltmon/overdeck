/**
 * Claude Code plugin provisioning (bundled marketplace plugins).
 *
 * `pan sync` distributes skills, agents, rules, and hooks by copying files —
 * but some capabilities ship as Claude Code *plugins* (marketplace-installed
 * bundles with their own commands and runtime, e.g. openai/codex-plugin-cc).
 * Those cannot be file-copied; they must be installed through the `claude
 * plugin` CLI so Claude Code tracks them in its own plugin registry.
 *
 * The bundled plugin set is declared in `sync-sources/plugins.json` — an array
 * of `{ plugin: "<name>@<marketplace>", marketplace: "<owner>/<repo>" }`
 * entries. Provisioning is a delta operation: already-installed plugins and
 * already-added marketplaces are left untouched, and a missing `claude` binary
 * or a failed network install degrades to a warning, never a sync failure.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { SYNC_SOURCES } from './paths.js';

const execFileAsync = promisify(execFile);

/** One entry in sync-sources/plugins.json. */
export interface BundledClaudePlugin {
  /** Plugin id as `claude plugin install` expects it: `<name>@<marketplace>`. */
  plugin: string;
  /** Marketplace source for `claude plugin marketplace add` (GitHub `owner/repo`, URL, or path). */
  marketplace: string;
}

export interface ProvisionClaudePluginsResult {
  /** False when provisioning could not run at all (no manifest problem — no claude CLI, bad manifest). */
  ok: boolean;
  /** Populated when ok is false. */
  reason?: string;
  /** Plugin ids installed by this run. */
  installed: string[];
  /** Plugin ids that were already installed. */
  alreadyInstalled: string[];
  /** Per-plugin failures (network, marketplace add, install). */
  errors: string[];
}

/** Network operations (marketplace clone, plugin install) get a generous timeout. */
const NETWORK_TIMEOUT_MS = 120_000;

function parseManifest(raw: string): BundledClaudePlugin[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const entries: BundledClaudePlugin[] = [];
  for (const item of parsed) {
    if (
      typeof item !== 'object' || item === null ||
      typeof (item as Record<string, unknown>).plugin !== 'string' ||
      typeof (item as Record<string, unknown>).marketplace !== 'string' ||
      !(item as { plugin: string }).plugin.includes('@')
    ) {
      return null;
    }
    entries.push({
      plugin: (item as { plugin: string }).plugin,
      marketplace: (item as { marketplace: string }).marketplace,
    });
  }
  return entries;
}

type ExecFn = (cmd: string, args: string[], opts: { timeout: number }) => Promise<{ stdout: string }>;

const defaultExec: ExecFn = (cmd, args, opts) => execFileAsync(cmd, args, opts);

/**
 * Ensure every plugin declared in sync-sources/plugins.json is installed in
 * Claude Code (user scope), adding its marketplace first when missing.
 */
export async function provisionClaudePlugins(
  options: { manifestPath?: string; exec?: ExecFn } = {},
): Promise<ProvisionClaudePluginsResult> {
  const manifestPath = options.manifestPath ?? SYNC_SOURCES.plugins;
  const exec = options.exec ?? defaultExec;
  const result: ProvisionClaudePluginsResult = { ok: true, installed: [], alreadyInstalled: [], errors: [] };

  if (!existsSync(manifestPath)) {
    return result; // No bundled plugins declared — nothing to do.
  }

  const entries = parseManifest(await readFile(manifestPath, 'utf-8'));
  if (entries === null) {
    return { ...result, ok: false, reason: `invalid plugin manifest at ${manifestPath}` };
  }
  if (entries.length === 0) return result;

  let installedIds: Set<string>;
  let marketplaceNames: Set<string>;
  try {
    const [pluginList, marketplaceList] = await Promise.all([
      exec('claude', ['plugin', 'list', '--json'], { timeout: 30_000 }),
      exec('claude', ['plugin', 'marketplace', 'list', '--json'], { timeout: 30_000 }),
    ]);
    installedIds = new Set(
      (JSON.parse(pluginList.stdout) as Array<{ id?: string }>).map((p) => p.id).filter((id): id is string => typeof id === 'string'),
    );
    marketplaceNames = new Set(
      (JSON.parse(marketplaceList.stdout) as Array<{ name?: string }>).map((m) => m.name).filter((n): n is string => typeof n === 'string'),
    );
  } catch {
    return { ...result, ok: false, reason: 'claude CLI not available (claude plugin list failed)' };
  }

  for (const entry of entries) {
    if (installedIds.has(entry.plugin)) {
      result.alreadyInstalled.push(entry.plugin);
      continue;
    }
    const marketplaceName = entry.plugin.slice(entry.plugin.indexOf('@') + 1);
    try {
      if (!marketplaceNames.has(marketplaceName)) {
        await exec('claude', ['plugin', 'marketplace', 'add', entry.marketplace], { timeout: NETWORK_TIMEOUT_MS });
        marketplaceNames.add(marketplaceName);
      }
      await exec('claude', ['plugin', 'install', entry.plugin, '--scope', 'user'], { timeout: NETWORK_TIMEOUT_MS });
      result.installed.push(entry.plugin);
    } catch (error) {
      result.errors.push(`${entry.plugin}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}
