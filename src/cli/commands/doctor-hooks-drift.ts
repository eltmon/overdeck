/**
 * Deployed-hook drift doctor check (PAN-3327).
 *
 * Compares the hook scripts in `~/.overdeck/bin/` against the `sync-sources/`
 * tree `pan sync` distributes from. Drift here is invisible in normal
 * operation: the stale hook keeps running, `pan sync` keeps reporting success,
 * and the only symptom is that a merged fix to agent behavior never takes
 * effect. Surfacing it as a check means an operator can find it without an
 * incident to reveal it — in PAN-3327 the CLI was resolving into a frozen
 * `pan reload` generation and copying its snapshot over itself for hours.
 */
import { join } from 'path';

import { isDeploymentGenerationRoot, packageRoot, SYNC_SOURCES } from '../../lib/paths.js';
import { planHooksSyncSync } from '../../lib/sync-hooks.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-inotify.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

/** How many drifted hook names to name before summarizing the rest. */
const MAX_NAMED = 5;

export function checkDeployedHooksDrift(
  plan: { name: string; status: 'new' | 'updated' | 'current' }[] = planHooksSyncSync(),
): CheckResult {
  const name = 'Deployed Hooks';

  if (plan.length === 0) {
    return { name, status: 'warn', message: `No hook sources found in ${SYNC_SOURCES.hooks}` };
  }

  const drifted = plan.filter((hook) => hook.status !== 'current');
  if (drifted.length === 0) {
    return { name, status: 'ok', message: `${plan.length} hooks match ${SYNC_SOURCES.root}` };
  }

  // A generation with no recorded checkout to redirect to cannot be fixed by
  // syncing again — it would redeploy the same frozen snapshot.
  const frozen = isDeploymentGenerationRoot(packageRoot)
    && SYNC_SOURCES.root === join(packageRoot, 'sync-sources');

  const names = drifted.slice(0, MAX_NAMED).map((hook) => hook.name).join(', ');
  const more = drifted.length > MAX_NAMED ? `, +${drifted.length - MAX_NAMED} more` : '';
  return {
    name,
    status: 'warn',
    message: `${drifted.length}/${plan.length} deployed hooks differ from ${SYNC_SOURCES.root} (${names}${more})`,
    fix: frozen
      ? 'This `pan` runs from a frozen `pan reload` generation with no recorded checkout — '
        + 'run `pan reload` to rebuild it from origin/main, then `pan sync`'
      : 'Run: pan sync',
  };
}
