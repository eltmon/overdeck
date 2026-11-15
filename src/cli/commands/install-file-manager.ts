/**
 * The optional `pan install` step that adds "Open in Overdeck" to the file
 * manager's right-click menu (PAN-5349 O-D14). It asks on a TTY, default No.
 * `--file-manager-integration` installs without asking;
 * `--skip-file-manager-integration` neither asks nor installs and wins over
 * the first flag. A failed install is a warning, never an install failure.
 */
import inquirer from 'inquirer';

/** The slice of ora's Ora that this step uses, so tests can pass a plain object. */
export interface FileManagerInstallSpinner {
  info(message: string): unknown;
  warn(message: string): unknown;
  succeed(message: string): unknown;
}

export interface SetupFileManagerOptions {
  skip?: boolean;
  force?: boolean;
  /** False in CI and in a piped `pan install`; a prompt there would hang the install. */
  isTty: boolean;
  spinner: FileManagerInstallSpinner;
  confirm?: () => Promise<boolean>;
  /** The same install `pan integrate file-manager` runs; resolves to an error message or null. */
  install?: () => Promise<string | null>;
}

export const FILE_MANAGER_PROMPT = 'Add "Open in Overdeck" to your file manager\'s right-click menu?';

async function defaultConfirm(): Promise<boolean> {
  const answer = await inquirer.prompt([{ type: 'confirm', name: 'add', message: FILE_MANAGER_PROMPT, default: false }]);
  return Boolean(answer.add);
}

async function defaultInstall(): Promise<string | null> {
  const { defaultIntegrateDeps, installFileManagerIntegration } = await import('./integrate.js');
  const result = await installFileManagerIntegration({ dryRun: false }, { ...defaultIntegrateDeps, log: () => undefined });
  return result.ok ? null : result.message;
}

export async function setupFileManagerIntegrationForInstall(options: SetupFileManagerOptions): Promise<void> {
  const { spinner } = options;
  if (options.skip) {
    spinner.info('Skipping the file-manager integration (--skip-file-manager-integration)');
    return;
  }
  if (!options.force) {
    if (!options.isTty) {
      spinner.info('Skipped the file-manager integration. Add it later with: pan integrate file-manager');
      return;
    }
    if (!(await (options.confirm ?? defaultConfirm)())) {
      spinner.info('Skipped the file-manager integration. Add it later with: pan integrate file-manager');
      return;
    }
  }
  try {
    const failure = await (options.install ?? defaultInstall)();
    if (failure) spinner.warn(`File-manager integration not installed: ${failure}`);
    else spinner.succeed('Added "Open in Overdeck" to the file manager (remove with: pan integrate file-manager --remove)');
  } catch (error) {
    spinner.warn(`File-manager integration not installed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
