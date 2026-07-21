import { getMergeBackendStatus, type MergeBackendStatus } from '../../../lib/github-app.js';
import { isFlywheelRequireUatBeforeMerge } from '../../../lib/overdeck/control-settings.js';

interface WarnNoMergeBackendDeps {
  isRequireUatBeforeMerge?: () => boolean;
  getStatus?: () => Promise<MergeBackendStatus>;
  warn?: (message: string) => void;
}

export function shouldWarnNoMergeBackend(requireUat: boolean, backend: MergeBackendStatus): boolean {
  return requireUat === false && backend.available === false;
}

export async function warnIfAutonomousMergeBackendUnavailable(deps: WarnNoMergeBackendDeps = {}): Promise<void> {
  try {
    const requireUat = (deps.isRequireUatBeforeMerge ?? isFlywheelRequireUatBeforeMerge)();
    const backend = await (deps.getStatus ?? getMergeBackendStatus)();
    if (!shouldWarnNoMergeBackend(requireUat, backend)) return;

    (deps.warn ?? console.warn)([
      '[overdeck] WARNING: autonomous merge backend is unavailable.',
      'flywheel.require_uat_before_merge=false means the Flywheel may schedule autonomous merges,',
      'but no GitHub App credentials or gh CLI authentication are available.',
      'Autonomous merge will fall back to the manual dashboard MERGE button until a merge backend is configured.',
      `Backend detail: ${backend.detail}`,
    ].join('\n'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (deps.warn ?? console.warn)(`[overdeck] WARNING: failed to check autonomous merge backend: ${message}`);
  }
}
