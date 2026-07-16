import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { join } from 'node:path';

import { packageRoot } from './paths.js';

export interface PanCliInvocation {
  command: string;
  args: string[];
}

/**
 * Invoke Overdeck's bundled CLI without relying on the dashboard process PATH.
 * GUI/service launches often omit the package-manager bin directory that owns
 * the `pan` shim, while the running Node executable and package bundle remain
 * stable and are sufficient to launch the CLI directly.
 */
export function panCliInvocation(
  args: readonly string[],
  runtime: { nodePath?: string; root?: string } = {},
): PanCliInvocation {
  return {
    command: runtime.nodePath ?? process.execPath,
    args: [join(runtime.root ?? packageRoot, 'dist', 'cli', 'index.js'), ...args],
  };
}

export function spawnPanCli(args: readonly string[], options: SpawnOptions = {}): ChildProcess {
  const invocation = panCliInvocation(args);
  return spawn(invocation.command, invocation.args, options);
}
