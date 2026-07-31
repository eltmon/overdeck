import { cp, lstat, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';

import { getLegacyHome, getOverdeckHome } from '../../../lib/paths.js';

interface LegacyAgentDirMigrationDeps {
  copy: (
    source: string,
    destination: string,
    options: { recursive: true; force: false; errorOnExist: true; preserveTimestamps: true },
  ) => Promise<void>;
  makeTempDir: (prefix: string) => Promise<string>;
  claimDestination: (destination: string) => Promise<(() => Promise<void>) | null>;
  rename: (source: string, destination: string) => Promise<void>;
  remove: (path: string, options: { recursive: true; force: true }) => Promise<void>;
}

export interface LegacyAgentDirMigrationOptions {
  legacyHome: string;
  currentHome: string;
  deps?: Partial<LegacyAgentDirMigrationDeps>;
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

async function claimMigrationDestination(
  destination: string,
): Promise<(() => Promise<void>) | null> {
  const claimPath = `${destination}.migrate-lock`;
  try {
    await mkdir(claimPath);
  } catch (error) {
    if (hasErrorCode(error, 'EEXIST')) return null;
    throw error;
  }
  return async () => { await rm(claimPath, { recursive: true, force: true }); };
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
  const deps: LegacyAgentDirMigrationDeps = {
    copy: cp,
    makeTempDir: mkdtemp,
    claimDestination: claimMigrationDestination,
    rename,
    remove: rm,
    ...options.deps,
  };
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

    const temporaryRoot = await deps.makeTempDir(join(currentAgentsDir, `.${entry.name}.migrate-`));
    const temporaryDestination = join(temporaryRoot, entry.name);
    try {
      await deps.copy(source, temporaryDestination, {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
      });
      const releaseClaim = await deps.claimDestination(destination);
      if (releaseClaim === null) {
        skipped++;
      } else {
        try {
          if (await pathExists(destination)) skipped++;
          else {
            await deps.rename(temporaryDestination, destination);
            copied++;
          }
        } catch (error) {
          if (!hasErrorCode(error, 'EEXIST') && !hasErrorCode(error, 'ENOTEMPTY')) throw error;
          skipped++;
        } finally {
          await releaseClaim();
        }
      }
    } finally {
      await deps.remove(temporaryRoot, { recursive: true, force: true });
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
