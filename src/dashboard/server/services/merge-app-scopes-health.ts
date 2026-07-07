import { emitActivityEntrySync, type EmitActivityOptions } from '../../../lib/activity-logger.js';
import {
  type AppCanMergeResult,
  verifyAppCanMerge,
} from '../../../lib/github-app.js';

interface WarnAppCannotMergeDeps {
  getResult?: () => Promise<AppCanMergeResult>;
  warn?: (message: string) => void;
  emit?: (options: EmitActivityOptions) => void;
}

export function shouldWarnAppCannotMerge(result: AppCanMergeResult): boolean {
  return result.configured === true && result.canMerge === false;
}

export async function warnIfAppCannotMerge(deps: WarnAppCannotMergeDeps = {}): Promise<void> {
  try {
    const getResult = deps.getResult ?? (() => verifyAppCanMerge());
    const result = await getResult();
    if (!shouldWarnAppCannotMerge(result)) return;

    const missing = result.missing ?? [];
    const message = [
      '[overdeck] WARNING: overdeck-agent GitHub App installation cannot merge pull requests.',
      `Missing required permissions: ${missing.join(', ')}.`,
      'Grant these permissions to the App installation to enable autonomous merges.',
    ].join('\n');

    (deps.warn ?? console.warn)(message);
    (deps.emit ?? emitActivityEntrySync)({
      source: 'dashboard',
      level: 'warn',
      message: `GitHub App installation cannot merge: missing ${missing.join(', ')}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (deps.warn ?? console.warn)(`[overdeck] WARNING: failed to verify GitHub App merge permissions: ${message}`);
  }
}
