/**
 * Non-interactive Claude Code hook provisioning for machines that never run
 * the pan CLI — the desktop app (PAN-2595).
 *
 * Mirrors what `pan admin hooks install` does, minus everything interactive:
 * copy the hook scripts from sync-sources/hooks/ into ~/.overdeck/bin/, then
 * delta-register them in ~/.claude/settings.json via the shared table
 * (src/lib/claude-hooks-registration.ts). Safe-settings guarantees hold
 * (PAN-1137): an unparseable settings.json is never overwritten — we skip
 * with a reason instead of process.exit — and every write is backed up and
 * atomic. Idempotent: a machine with everything registered results in no
 * write at all.
 *
 * Never throws; returns a result the caller can log. Runs async probes only
 * (no execSync — this is server-boot-reachable code).
 */

import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  applyOverdeckHookRegistrations,
  HOOK_SCRIPT_NAMES,
  type ClaudeSettings,
} from './claude-hooks-registration.js';
import { atomicWriteJsonSync, backupSettingsSync, pruneBackupsSync } from './claude-settings-file.js';
import { BIN_DIR, SYNC_SOURCES } from './paths.js';

const execFileAsync = promisify(execFile);

export interface ProvisionClaudeHooksResult {
  ok: boolean;
  /** Human-readable reason when ok=false or when provisioning was skipped. */
  reason?: string;
  /** Whether settings.json was written (false when already fully registered). */
  changed: boolean;
  binariesSynced: number;
  registered: string[];
  pruned: string[];
}

async function commandAvailable(cmd: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(cmd, args, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export async function provisionClaudeHooks(
  options: { settingsPath?: string; binDir?: string } = {},
): Promise<ProvisionClaudeHooksResult> {
  const settingsPath = options.settingsPath ?? join(homedir(), '.claude', 'settings.json');
  const binDir = options.binDir ?? BIN_DIR;
  const none: Omit<ProvisionClaudeHooksResult, 'ok' | 'reason'> = {
    changed: false,
    binariesSynced: 0,
    registered: [],
    pruned: [],
  };

  try {
    if (!existsSync(SYNC_SOURCES.hooks)) {
      return { ok: false, reason: `hook sources not shipped in this install (${SYNC_SOURCES.hooks})`, ...none };
    }
    // The hook scripts are jq-dependent bash; without jq they fail silently on
    // every tool call. Skip and let the setup checklist surface the gap.
    if (!(await commandAvailable('jq', ['--version']))) {
      return { ok: false, reason: 'jq is not installed — hooks require it (see the setup checklist)', ...none };
    }

    // Copy the explicit script list (NOT syncHooksSync — its extension filter
    // skips pan-hook-lib.sh, the shared library every hook sources).
    mkdirSync(binDir, { recursive: true });
    let binariesSynced = 0;
    for (const scriptName of HOOK_SCRIPT_NAMES) {
      const sourcePath = join(SYNC_SOURCES.hooks, scriptName);
      if (!existsSync(sourcePath)) {
        return { ok: false, reason: `hook script missing from install: ${sourcePath}`, ...none };
      }
      copyFileSync(sourcePath, join(binDir, scriptName));
      chmodSync(join(binDir, scriptName), 0o755);
      binariesSynced++;
    }

    // Read settings ourselves: parse failure means SKIP, never overwrite
    // (PAN-1137). A missing file is a legitimate fresh install.
    let settings: ClaudeSettings = {};
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(await readFile(settingsPath, 'utf-8')) as ClaudeSettings;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          reason: `${settingsPath} is not valid JSON (${msg}) — refusing to write; fix or restore a .pan-backup first`,
          ...none,
          binariesSynced,
        };
      }
    }

    const python3Available = await commandAvailable('python3', ['--version']);
    const { added, removed } = applyOverdeckHookRegistrations(settings, binDir, { python3Available });

    if (added.length === 0 && removed.length === 0) {
      return { ok: true, changed: false, binariesSynced, registered: [], pruned: [] };
    }

    backupSettingsSync(settingsPath);
    atomicWriteJsonSync(settingsPath, settings);
    pruneBackupsSync(settingsPath);
    return { ok: true, changed: true, binariesSynced, registered: added, pruned: removed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg, ...none };
  }
}
