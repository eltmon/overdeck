/**
 * PAN-2630: `pan install`/`pan sync` and every non-remote launcher (re)write
 * a `pan`/`overdeck` exec shim to `<OVERDECK_HOME>/cli-bin`, but nothing
 * previously told the operator whether their own shell actually resolves
 * `pan` at all. A warn-only presence check: agents no longer depend on it
 * (the launcher writes its own copy), so a missing shell PATH entry is
 * advisory, not a doctor failure.
 */

import { join } from 'node:path';

import { findExecutableOnPath, panCliShimDir } from '../../lib/pan-cli-shim.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-cli-generation.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export function checkPanOnPath(deps: {
  pathEnv?: string;
  find?: typeof findExecutableOnPath;
  shimDir?: string;
} = {}): CheckResult {
  const pathEnv = deps.pathEnv ?? process.env.PATH;
  const find = deps.find ?? findExecutableOnPath;
  const shimDir = deps.shimDir ?? panCliShimDir();

  const resolved = find('pan', pathEnv);
  if (resolved !== null) {
    const isShim = resolved === join(shimDir, 'pan');
    return {
      name: 'pan on PATH',
      status: 'ok',
      message: isShim ? `${resolved} (Overdeck shim)` : resolved,
    };
  }

  return {
    name: 'pan on PATH',
    status: 'warn',
    message: `pan is not on PATH in this shell (agents get it from ${shimDir})`,
    fix: `Run npm install -g @overdeck/core, or npm link inside your Overdeck checkout after npm run build, or add export PATH="${shimDir}:$PATH" to your shell profile (pan sync writes that shim)`,
  };
}
