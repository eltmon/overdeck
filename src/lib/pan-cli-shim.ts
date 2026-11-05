/**
 * PAN-2630: a source checkout puts `pan` on no one's PATH — not the operator
 * shell (no `npm install -g`/`npm link`), and not a spawned agent (whose
 * launcher only prepends the harness binary directory). This module renders
 * an exec shim for `pan`/`overdeck` and the bash lines that (re)write it at
 * launch time.
 *
 * D-1: the shim `exec`s the generating process's own node by absolute path,
 * not a symlink through a `#!/usr/bin/env node` shebang, so it never picks up
 * a missing or stale `node` from PATH.
 * D-3: every launcher re-writes the shim from this module's own rendering, so
 * no launch depends on `pan install`/`pan sync` having run first.
 * D-4: the launcher lines prepend the shim directory ahead of the harness
 * PATH line, so agents run the same CLI build as the process that spawned
 * them.
 * D-6: when the generating process is Electron (desktop server), the shim
 * exports `ELECTRON_RUN_AS_NODE=1` before `exec`, or `exec`ing the Electron
 * binary would relaunch the desktop app instead of running the CLI.
 */
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { panCliInvocation } from './pan-cli-invocation.js';
import { getOverdeckHome } from './paths.js';
import { shellQuote } from './shell-quote.js';

export interface PanCliShimRuntime {
  nodePath?: string;
  root?: string;
  electron?: boolean;
  dir?: string;
}

export type PanCliShimWriteResult =
  | { status: 'written'; dir: string }
  | { status: 'missing-bundle'; bundle: string }
  | { status: 'error'; message: string };

const SHIM_NAMES = ['pan', 'overdeck'] as const;
const HEREDOC_DELIMITER = 'OVERDECK_PAN_SHIM';

/** `<OVERDECK_HOME>/cli-bin`, read at call time so OVERDECK_HOME overrides apply. */
export function panCliShimDir(): string {
  return join(getOverdeckHome(), 'cli-bin');
}

/** Absolute path of the CLI bundle the shim execs. */
export function panCliBundlePath(runtime: PanCliShimRuntime = {}): string {
  return panCliInvocation([], { nodePath: runtime.nodePath, root: runtime.root }).args[0];
}

function resolveElectron(runtime: PanCliShimRuntime): boolean {
  return (
    runtime.electron ??
    (Boolean(process.versions.electron) || process.env.ELECTRON_RUN_AS_NODE === '1')
  );
}

/** Shim file content: `#!/bin/sh`, an optional Electron export, then the `exec` line. */
export function renderPanCliShim(runtime: PanCliShimRuntime = {}): string {
  const node = runtime.nodePath ?? process.execPath;
  const bundle = panCliBundlePath(runtime);
  const electronLine = resolveElectron(runtime) ? 'export ELECTRON_RUN_AS_NODE=1\n' : '';
  return `#!/bin/sh\n${electronLine}exec ${shellQuote(node)} ${shellQuote(bundle)} "$@"\n`;
}

/**
 * Bash lines a launcher runs to (re)write the shim and prepend its directory
 * to PATH. Atomic (temp file + chmod + mv) and best-effort: any failure
 * leaves PATH untouched and removes the temp files, without aborting the
 * launcher (D-5).
 */
export function panCliShimLauncherLines(runtime: PanCliShimRuntime = {}): string[] {
  const dir = shellQuote(runtime.dir ?? panCliShimDir());
  const bundle = shellQuote(panCliBundlePath(runtime));
  const shimLines = renderPanCliShim(runtime).split('\n');
  shimLines.pop();

  return [
    `if [ -f ${bundle} ] && mkdir -p ${dir} 2>/dev/null \\`,
    `  && cat > ${dir}/pan.tmp.$$ <<'${HEREDOC_DELIMITER}'`,
    ...shimLines,
    HEREDOC_DELIMITER,
    'then',
    `  if chmod 0755 ${dir}/pan.tmp.$$ && cp -p ${dir}/pan.tmp.$$ ${dir}/overdeck.tmp.$$ \\`,
    `    && mv -f ${dir}/overdeck.tmp.$$ ${dir}/overdeck && mv -f ${dir}/pan.tmp.$$ ${dir}/pan; then`,
    `    export PATH=${dir}:"$PATH"`,
    '  fi',
    `  rm -f ${dir}/pan.tmp.$$ ${dir}/overdeck.tmp.$$ 2>/dev/null`,
    'fi',
  ];
}

/**
 * Async atomic write of `pan` and `overdeck` into the shim directory. Never
 * throws: a missing bundle or any fs failure comes back as a typed result.
 */
export async function writePanCliShims(runtime: PanCliShimRuntime = {}): Promise<PanCliShimWriteResult> {
  const bundle = panCliBundlePath(runtime);
  try {
    if (!existsSync(bundle)) {
      return { status: 'missing-bundle', bundle };
    }
    const dir = runtime.dir ?? panCliShimDir();
    await mkdir(dir, { recursive: true });
    const content = renderPanCliShim(runtime);
    for (const name of SHIM_NAMES) {
      const tmpPath = join(dir, `${name}.${randomUUID()}.tmp`);
      await writeFile(tmpPath, content, { mode: 0o755 });
      await rename(tmpPath, join(dir, name));
    }
    return { status: 'written', dir };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

function defaultIsExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** First executable `name` found on `pathEnv`, or `null` if there is none. */
export function findExecutableOnPath(
  name: string,
  pathEnv: string | undefined,
  deps: { isExecutableFile?: (path: string) => boolean } = {},
): string | null {
  if (!pathEnv) return null;
  const isExecutableFile = deps.isExecutableFile ?? defaultIsExecutableFile;
  for (const segment of pathEnv.split(':')) {
    if (!segment) continue;
    const candidate = join(segment, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}
