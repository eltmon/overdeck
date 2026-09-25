/**
 * CLI startup guard (PAN-4195).
 *
 * Every `pan` call used to evaluate every command module and ~78 npm packages
 * (~1160 modules, ~0.5 s) before parsing argv. Command implementations now load
 * on demand (`lazyAction`, `command-groups.ts`). These tests run the built CLI
 * under a module-tracing preload and fail when a static import drags a command
 * implementation back into startup.
 *
 * What still loads on `--version` is the entry, Commander, chalk and the CLI
 * telemetry lifecycle (config loader + PostHog). If a change must raise the
 * budget, find the new eager import first: `PAN_MODULE_TRACE=/tmp/t.txt
 * PAN_MODULE_TRACE_PARENTS=1 node --import ./tests/helpers/module-trace.mjs
 * dist/cli/index.js --version` prints `<parent> -> <module>` lines.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../..');
const CLI_PATH = join(ROOT, 'dist/cli/index.js');
const TRACE_PRELOAD = join(ROOT, 'tests/helpers/module-trace.mjs');

/** A cold CLI start can take seconds on a loaded CI runner (PAN-4032). */
const CLI_SPAWN_TIMEOUT_MS = 30_000;

/** ~360 today (was ~1160); headroom for small growth, not for a command graph. */
const STARTUP_MODULE_BUDGET = 500;

/** Packages only command implementations use. None may load before a command runs. */
const COMMAND_ONLY_PACKAGES = [
  'drizzle-orm',
  '@anthropic-ai/sdk',
  '@linear/sdk',
  '@octokit/rest',
  '@effect/platform-node',
  '@iarna/toml',
  'inquirer',
  'ora',
  'rxjs',
  'ws',
];

function traceModules(args: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'pan-startup-trace-'));
  const traceFile = join(dir, 'modules.txt');
  try {
    execFileSync(process.execPath, ['--import', TRACE_PRELOAD, CLI_PATH, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: CLI_SPAWN_TIMEOUT_MS,
      env: { ...process.env, PAN_MODULE_TRACE: traceFile, OVERDECK_TELEMETRY: '0' },
    });
    return readFileSync(traceFile, 'utf-8').split('\n').filter(Boolean);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function loadedPackages(modules: string[]): Set<string> {
  const packages = new Set<string>();
  for (const url of modules) {
    const match = /.*\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(url);
    if (match) packages.add(match[1]);
  }
  return packages;
}

describe.each([
  { label: '--version', args: ['--version'] },
  { label: 'tell --help', args: ['tell', '--help'] },
  { label: 'review request --help', args: ['review', 'request', '--help'] },
])('pan $label startup', ({ args }) => {
  it('stays within the module budget and loads no command-only package', () => {
    const modules = traceModules(args);

    // The preload must actually have traced the run.
    expect(modules.some((url) => url.endsWith('/dist/cli/index.js'))).toBe(true);
    const packages = loadedPackages(modules);
    expect(packages.has('commander')).toBe(true);

    expect(COMMAND_ONLY_PACKAGES.filter((name) => packages.has(name))).toEqual([]);
    expect(modules.length).toBeLessThanOrEqual(STARTUP_MODULE_BUDGET);
  }, CLI_SPAWN_TIMEOUT_MS);
});
