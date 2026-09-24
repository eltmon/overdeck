/**
 * Sync-sources checkout freshness doctor check (PAN-3881).
 *
 * `pan sync` distributes from the primary checkout's `sync-sources/` when it
 * can (PAN-3327). A checkout that is behind its upstream, on a feature branch,
 * or detached makes every sync distribute an old tree, reverting merged rule
 * changes and resurrecting deleted skills and agents. This row surfaces that
 * before the next sync does it.
 *
 * Doctor must stay fast and must work offline, so it does not fetch: it
 * compares HEAD with the last-fetched upstream ref and says so. `pan sync`
 * itself fetches before comparing.
 */
import { join } from 'path';

import { isDeploymentGenerationRoot, packageRoot, SYNC_SOURCES } from '../../lib/paths.js';
import { checkSyncSourceFreshness } from '../../lib/sync-source-freshness.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-hooks-drift.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

const NAME = 'Sync Sources Checkout';

export interface SyncSourceCheckoutOptions {
  sourcesRoot?: string;
  /** True when sync distributes a frozen `pan reload` generation's own copy. */
  frozenGeneration?: boolean;
  check?: typeof checkSyncSourceFreshness;
}

export async function checkSyncSourceCheckout(options: SyncSourceCheckoutOptions = {}): Promise<CheckResult> {
  const sourcesRoot = options.sourcesRoot ?? SYNC_SOURCES.root;
  const frozenGeneration = options.frozenGeneration
    ?? (isDeploymentGenerationRoot(packageRoot) && sourcesRoot === join(packageRoot, 'sync-sources'));
  const check = options.check ?? checkSyncSourceFreshness;

  // A generation is a detached build of origin/main by design; the Deployed
  // Hooks row already reports when syncing from it is stale.
  if (frozenGeneration) {
    return { name: NAME, status: 'ok', message: `Distributing from a frozen \`pan reload\` generation (${sourcesRoot})` };
  }

  try {
    const freshness = await check(sourcesRoot, { skipFetch: true });
    if (!freshness) {
      return { name: NAME, status: 'ok', message: `${sourcesRoot} is not in a git checkout (package install)` };
    }
    const compared = freshness.upstream
      ? `compared with the last-fetched ${freshness.upstream}; doctor does not fetch`
      : 'no upstream ref to compare with';
    if (freshness.warnings.length === 0) {
      return {
        name: NAME,
        status: 'ok',
        message: `${freshness.checkout} on '${freshness.branch}' is current (${compared})`,
      };
    }
    return {
      name: NAME,
      status: 'warn',
      message: `${freshness.warnings.join(' ')} (${compared})`,
      fix: `Update ${freshness.checkout} to ${freshness.upstream ?? `origin/${freshness.defaultBranch}`} `
        + `(e.g. \`git -C ${freshness.checkout} pull --ff-only\` on ${freshness.defaultBranch}), then run \`pan sync\``,
    };
  } catch (error) {
    return { name: NAME, status: 'warn', message: `check failed: ${(error as Error).message}` };
  }
}
