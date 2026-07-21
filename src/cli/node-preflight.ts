// Node version preflight: Overdeck's dashboard and runtime require Node 22+
// (node-pty native addon, bundled node:sqlite driver, Effect strict ESM). The
// CLI bin runs under `#!/usr/bin/env node` — whatever the user's shell resolves
// — so a user whose default is older Node would otherwise fail late and
// confusingly. Instead we relaunch under an already-installed compatible Node
// when one exists, and fail fast with a manager-specific fix command when not.
//
// This module is imported first in src/cli/index.ts and its only dependencies
// are Node built-ins, so it loads and runs under old Node without issue.

import { spawnSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Minimum is 22.16, not merely major 22: the bundled node:sqlite driver
// (src/lib/database/driver.ts) requires Node 22.16+ or 24+ — older 22.x builds
// need --experimental-sqlite and are unsupported. Relaunching onto a 22.5-22.15
// would only defer the failure, so we treat those as incompatible here too.
const MIN_MAJOR = 22;
const MIN_MINOR = 16;
const MIN_LABEL = `${MIN_MAJOR}.${MIN_MINOR}`;
const RELAUNCH_ENV = 'OVERDECK_NODE_RELAUNCHED';

export interface NodeCandidate {
  path: string;
  version: string;
  major: number;
  minor: number;
}

export function parseNodeVersion(raw: string): { major: number; minor: number } | null {
  const match = raw.trim().match(/^v?(\d+)\.(\d+)\.\d+/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

export function meetsMinimum(version: { major: number; minor: number }): boolean {
  if (version.major > MIN_MAJOR) return true;
  return version.major === MIN_MAJOR && version.minor >= MIN_MINOR;
}

type ProbeFn = (path: string) => NodeCandidate | null;

function probeNode(path: string): NodeCandidate | null {
  if (!existsSync(path)) return null;
  try {
    const result = spawnSync(path, ['--version'], { encoding: 'utf-8', timeout: 5000 });
    if (result.status !== 0 || !result.stdout) return null;
    const parsed = parseNodeVersion(result.stdout);
    if (!parsed) return null;
    return { path, version: result.stdout.trim(), major: parsed.major, minor: parsed.minor };
  } catch {
    return null;
  }
}

function pushVersionDirs(acc: string[], base: string, toBin: (dir: string) => string): void {
  if (!existsSync(base)) return;
  try {
    for (const name of readdirSync(base)) acc.push(toBin(join(base, name)));
  } catch {
    // ignore unreadable directories
  }
}

// Known locations where a compatible Node may be installed even when it is not
// the shell default. Ordered fixed paths first, then version-manager installs.
export function candidateNodePaths(home = homedir()): string[] {
  const paths: string[] = [
    '/opt/homebrew/opt/node@24/bin/node',
    '/opt/homebrew/opt/node@22/bin/node',
    '/usr/local/opt/node@24/bin/node',
    '/usr/local/opt/node@22/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ];
  pushVersionDirs(paths, join(home, '.nvm/versions/node'), (dir) => join(dir, 'bin/node'));
  pushVersionDirs(paths, join(home, '.local/share/fnm/node-versions'), (dir) =>
    join(dir, 'installation/bin/node'),
  );
  pushVersionDirs(paths, join(home, 'Library/Application Support/fnm/node-versions'), (dir) =>
    join(dir, 'installation/bin/node'),
  );
  pushVersionDirs(paths, join(home, '.volta/tools/image/node'), (dir) => join(dir, 'bin/node'));
  pushVersionDirs(paths, join(home, '.asdf/installs/nodejs'), (dir) => join(dir, 'bin/node'));
  return paths;
}

// Returns the highest-versioned compatible Node from the candidate list, or null.
export function findCompatibleNode(
  paths: string[] = candidateNodePaths(),
  probe: ProbeFn = probeNode,
): NodeCandidate | null {
  const found: NodeCandidate[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    const candidate = probe(path);
    if (candidate && meetsMinimum(candidate)) found.push(candidate);
  }
  if (found.length === 0) return null;
  found.sort((a, b) => b.major - a.major || b.minor - a.minor);
  return found[0]!;
}

// The exact install command for whichever version manager the user has.
export function detectVersionManagerHint(home = homedir()): string {
  if (existsSync(join(home, '.nvm'))) return 'nvm install 22 && nvm use 22';
  if (
    existsSync(join(home, '.local/share/fnm')) ||
    existsSync(join(home, 'Library/Application Support/fnm'))
  )
    return 'fnm install 22 && fnm use 22';
  if (existsSync(join(home, '.volta'))) return 'volta install node@22';
  if (existsSync(join(home, '.asdf')))
    return 'asdf install nodejs latest:22 && asdf global nodejs latest:22';
  if (existsSync('/opt/homebrew/bin/brew') || existsSync('/usr/local/bin/brew'))
    return 'brew install node@22 && brew link --overwrite node@22';
  return 'Install Node 22 from https://nodejs.org/en/download';
}

function describeSource(path: string): string {
  if (path.includes('node@')) return 'homebrew';
  if (path.includes('/.nvm/')) return 'nvm';
  if (path.includes('fnm')) return 'fnm';
  if (path.includes('/.volta/')) return 'volta';
  if (path.includes('/.asdf/')) return 'asdf';
  return path;
}

function failNoCompatibleNode(): never {
  process.stderr.write(
    `\nOverdeck requires Node.js ${MIN_LABEL} or later. You are running Node.js ${process.versions.node}.\n`,
  );
  process.stderr.write(`No compatible Node was found on this system. Install Node ${MIN_LABEL}+ with:\n\n`);
  process.stderr.write(`  ${detectVersionManagerHint()}\n\n`);
  process.stderr.write('then re-run your command.\n');
  process.exit(1);
}

// Called first at CLI startup. If the current Node is too old, relaunch the CLI
// under a compatible one; if none exists, fail fast with a specific fix command.
// A no-op when already on Node 22+.
export function ensureCompatibleNode(argv: string[] = process.argv, env = process.env): void {
  const current = parseNodeVersion(process.versions.node);
  if (current && meetsMinimum(current)) return;

  // Already relaunched once — do not loop; the relaunch target was still too old.
  if (env[RELAUNCH_ENV] === '1') failNoCompatibleNode();

  const compatible = findCompatibleNode();
  if (compatible) {
    process.stderr.write(
      `[overdeck] Node ${process.versions.node} is too old; relaunching under ` +
        `Node ${compatible.major}.${compatible.minor} (${describeSource(compatible.path)})...\n`,
    );
    const script = argv[1]!;
    const result = spawnSync(compatible.path, [script, ...argv.slice(2)], {
      stdio: 'inherit',
      env: { ...env, [RELAUNCH_ENV]: '1' },
    });
    process.exit(result.status ?? 1);
  }

  failNoCompatibleNode();
}
