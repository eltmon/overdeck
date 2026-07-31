import { cp, lstat, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';

import { getLegacyHome, getOverdeckHome } from '../../../lib/paths.js';

export interface LegacyAgentDirMigrationOptions {
  legacyHome: string;
  currentHome: string;
}

export interface LegacyAgentDirMigrationResult {
  copied: number;
  skipped: number;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false;
    throw error;
  }
}

/**
 * Copy pre-rebrand conversation agent dirs into the current Overdeck home.
 * The legacy side is read-only; existing destinations are always skipped.
 */
export async function migrateLegacyAgentDirs(
  options: LegacyAgentDirMigrationOptions,
): Promise<LegacyAgentDirMigrationResult> {
  const legacyAgentsDir = join(options.legacyHome, 'agents');
  const currentAgentsDir = join(options.currentHome, 'agents');
  let entries;
  try {
    entries = await readdir(legacyAgentsDir, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return { copied: 0, skipped: 0 };
    throw error;
  }

  const conversationDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('conv-'))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (conversationDirs.length === 0) return { copied: 0, skipped: 0 };

  await mkdir(currentAgentsDir, { recursive: true });
  let copied = 0;
  let skipped = 0;
  for (const entry of conversationDirs) {
    const source = join(legacyAgentsDir, entry.name);
    const destination = join(currentAgentsDir, entry.name);
    if (await pathExists(destination)) {
      skipped++;
      continue;
    }

    try {
      await cp(source, destination, {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
      });
      copied++;
    } catch (error) {
      if (hasErrorCode(error, 'EEXIST')) {
        skipped++;
        continue;
      }
      throw error;
    }
  }

  return { copied, skipped };
}

export function resolveLegacyAgentDirMigrationHomes(): LegacyAgentDirMigrationOptions {
  return {
    legacyHome: getLegacyHome(),
    currentHome: getOverdeckHome(),
  };
}

export async function runMigrateLegacyAgentDirsCommand(
  options: LegacyAgentDirMigrationOptions,
  log: (message: string) => void = console.log,
): Promise<LegacyAgentDirMigrationResult> {
  const result = await migrateLegacyAgentDirs(options);
  log(`copied ${result.copied}, skipped ${result.skipped}`);
  return result;
}

export function registerMigrateLegacyAgentDirsCommand(admin: Command): void {
  admin
    .command('migrate-legacy-agent-dirs')
    .description('Copy pre-rebrand conv-* agent dirs into the configured Overdeck home without overwriting')
    .action(async () => {
      await runMigrateLegacyAgentDirsCommand(resolveLegacyAgentDirMigrationHomes());
    });
}
