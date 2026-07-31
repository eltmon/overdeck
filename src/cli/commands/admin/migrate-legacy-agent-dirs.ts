import { cp, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
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

const CLAIM_METADATA_GRACE_MS = 30_000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasErrorCode(error, 'ESRCH');
  }
}

async function claimMigrationDestination(
  destination: string,
): Promise<(() => Promise<void>) | null> {
  const claimPath = `${destination}.migrate-lock`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(claimPath, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      await handle.close();
      return async () => { await rm(claimPath, { force: true }); };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (!hasErrorCode(error, 'EEXIST')) {
        await rm(claimPath, { recursive: true, force: true });
        throw error;
      }
    }

    let ownerPid: number | null = null;
    try {
      const owner = JSON.parse(await readFile(claimPath, 'utf8')) as { pid?: unknown };
      if (typeof owner.pid === 'number' && Number.isInteger(owner.pid) && owner.pid > 0) {
        ownerPid = owner.pid;
      }
    } catch { /* incomplete or legacy claim; age check below */ }
    if (ownerPid !== null && isProcessAlive(ownerPid)) return null;
    if (ownerPid === null) {
      try {
        if (Date.now() - (await stat(claimPath)).mtimeMs < CLAIM_METADATA_GRACE_MS) return null;
      } catch (error) {
        if (hasErrorCode(error, 'ENOENT')) continue;
        throw error;
      }
    }
    await rm(claimPath, { recursive: true, force: true });
  }
  return null;
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
