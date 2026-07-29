/**
 * Whether a built dashboard deployment can actually boot from where it sits.
 *
 * PAN-3264: a live `pan reload` generation had its source tree and its
 * `node_modules/.bun` store deleted underneath the running server. Bun's
 * isolated install layout makes every top-level `node_modules` entry a symlink
 * into that store, so all 31 of them went dangling at once and the server died
 * on `ERR_MODULE_NOT_FOUND: Cannot find package 'effect'`. `dist/dashboard/
 * server.js` itself still existed, so every existence-based check — including
 * the active-bundle marker's own — kept reporting the deployment as fine, and
 * `pan restart --dashboard` relaunched the poisoned tree on every attempt. The
 * dashboard stayed down for 14 minutes and recovered only via a manual `git
 * checkout` + `bun install` inside the deployment directory.
 *
 * Existence is not bootability. Resolving the bundle's own bare imports from
 * its own location is the same question Node asks at boot, so a deployment that
 * cannot boot is detectable before it is launched — and before the healthy one
 * is torn down.
 */

import { existsSync } from 'node:fs';

import { unresolvedBundleImports } from '../bundle-imports.js';

/**
 * Why the dashboard server bundle at `serverPath` cannot boot, or null if it can.
 *
 * Only the entry bundle is probed: it is what Node loads first, its externals
 * are the ones a broken deployment strands, and the check has to be cheap
 * enough to run on the restart path.
 */
export function dashboardServerBootFailure(serverPath: string): string | null {
  if (!existsSync(serverPath)) return `Dashboard bundle missing at ${serverPath}`;

  const missing = unresolvedBundleImports(serverPath);
  if (missing.length === 0) return null;
  return `Deployment cannot resolve ${missing.join(', ')} from ${serverPath} — `
    + 'the dashboard server would die on ERR_MODULE_NOT_FOUND at boot. '
    + 'Run `bun install` in the deployment root, then reload again';
}
