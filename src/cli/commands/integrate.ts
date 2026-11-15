/**
 * `pan integrate file-manager [--remove] [--dry-run]` (PAN-5349 O-D12):
 * add or remove the right-click "Open in Overdeck" entry in the operating
 * system's file manager. `pan install` calls `installFileManagerIntegration`
 * too, so both write the same files and the same state record.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';

import {
  applyFileManagerPlan,
  describeFileManagerPlan,
  installIcon,
  integrationsDir,
  isFileManagerPlatform,
  planFileManagerInstall,
  planFileManagerRemove,
  readFileManagerState,
  removeFileManagerState,
  resolvePanPath,
  writeFileManagerState,
  type FileManagerPlan,
  type FileManagerPlatform,
  type FileManagerState,
} from '../../lib/integrations/file-manager.js';

export interface IntegrateDeps {
  platform: string;
  home: string;
  /** Defaults to getOverdeckHome() inside the integration module. */
  overdeckHome?: string;
  resolvePanPath: (platform: FileManagerPlatform) => string | null;
  installIcon: (overdeckHome?: string) => Promise<string | null>;
  apply: (plan: FileManagerPlan, note: (line: string) => void) => Promise<void>;
  readState: (overdeckHome?: string) => Promise<FileManagerState | null>;
  writeState: (state: FileManagerState, overdeckHome?: string) => Promise<void>;
  removeState: (overdeckHome?: string) => Promise<void>;
  now: () => Date;
  log: (line: string) => void;
}

export const defaultIntegrateDeps: IntegrateDeps = {
  platform: process.platform,
  home: homedir(),
  resolvePanPath: (platform) => resolvePanPath(platform),
  installIcon: (overdeckHome) => installIcon(overdeckHome),
  apply: (plan, note) => applyFileManagerPlan(plan, { note }),
  readState: readFileManagerState,
  writeState: writeFileManagerState,
  removeState: removeFileManagerState,
  now: () => new Date(),
  log: (line) => console.log(line),
};

export type IntegrateResult = { ok: true } | { ok: false; message: string };

export const PAN_NOT_INSTALLED = 'pan is not installed on PATH. Run: pan sync';

/** Install the integration, or with `dryRun` print what it would do. */
export async function installFileManagerIntegration(
  options: { dryRun?: boolean },
  deps: IntegrateDeps = defaultIntegrateDeps,
): Promise<IntegrateResult> {
  const { platform } = deps;
  if (!isFileManagerPlatform(platform)) return { ok: false, message: `No file-manager integration for ${platform}` };
  const panPath = deps.resolvePanPath(platform);
  if (!panPath) return { ok: false, message: PAN_NOT_INSTALLED };

  // Only Linux entries carry an icon (O-D12).
  const wantsIcon = platform === 'linux';
  const iconPath = !wantsIcon
    ? null
    : options.dryRun
      ? join(integrationsDir(deps.overdeckHome), 'overdeck.svg')
      : await deps.installIcon(deps.overdeckHome);
  const plan = planFileManagerInstall({ platform, home: deps.home, panPath, iconPath });

  if (options.dryRun) {
    deps.log(`Would install "Open in Overdeck" running ${panPath}:`);
    if (iconPath) deps.log(`copy   ${iconPath}`);
    for (const line of describeFileManagerPlan(plan)) deps.log(line);
    return { ok: true };
  }

  await deps.apply(plan, deps.log);
  await deps.writeState(
    {
      installed: true,
      platform,
      panPath,
      at: deps.now().toISOString(),
      files: plan.files.map((file) => file.path),
      registryKeys: plan.registryKeys,
    },
    deps.overdeckHome,
  );
  for (const file of plan.files) deps.log(`Wrote ${file.path}`);
  for (const key of plan.registryKeys) deps.log(`Added ${key}`);
  return { ok: true };
}

/** Remove what the state file recorded, or with `dryRun` print it. */
export async function removeFileManagerIntegration(
  options: { dryRun?: boolean },
  deps: IntegrateDeps = defaultIntegrateDeps,
): Promise<IntegrateResult> {
  const state = await deps.readState(deps.overdeckHome);
  if (!state) {
    deps.log('Nothing to remove');
    return { ok: true };
  }
  const plan = planFileManagerRemove(state);
  if (options.dryRun) {
    deps.log('Would remove "Open in Overdeck":');
    for (const line of describeFileManagerPlan(plan)) deps.log(line);
    return { ok: true };
  }
  await deps.apply(plan, deps.log);
  await deps.removeState(deps.overdeckHome);
  for (const path of plan.deletes) deps.log(`Deleted ${path}`);
  for (const key of plan.registryKeys) deps.log(`Removed ${key}`);
  return { ok: true };
}

/** The `pan integrate file-manager` action; returns the exit code. */
export async function runIntegrateFileManager(
  options: { remove?: boolean; dryRun?: boolean },
  deps: IntegrateDeps = defaultIntegrateDeps,
  error: (line: string) => void = (line) => console.error(line),
): Promise<number> {
  const result = options.remove
    ? await removeFileManagerIntegration({ dryRun: options.dryRun }, deps)
    : await installFileManagerIntegration({ dryRun: options.dryRun }, deps);
  if (!result.ok) {
    error(result.message);
    return 1;
  }
  return 0;
}

export function registerIntegrateCommands(program: Command): void {
  const integrate = program
    .command('integrate')
    .description('Add Overdeck to other tools on this machine');
  integrate
    .command('file-manager')
    .description('Add "Open in Overdeck" to the file manager\'s right-click menu')
    .option('--remove', 'Remove the entries this command added')
    .option('--dry-run', 'Print what would be written, deleted or run, and change nothing')
    .action(async (options: { remove?: boolean; dryRun?: boolean }) => {
      const code = await runIntegrateFileManager(options);
      if (code !== 0) {
        const { exitCli } = await import('../exit.js');
        await exitCli(code);
      }
    });
}
