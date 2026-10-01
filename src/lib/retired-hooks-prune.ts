/**
 * Pure settings/mcp.json pruning for the hook scripts Overdeck retired
 * (PAN-4429). A leaf module on purpose: claude-hooks-registration.ts imports
 * it, and that module is reachable from `pan vault`, which must not pull in
 * the project registry or Effect (tests/unit/lib/vault/import-graph.test.ts).
 * The file-system migration lives in retired-hooks.ts.
 */

import { join } from 'node:path';

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
