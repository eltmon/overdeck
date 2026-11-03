/**
 * sageox pack build (PAN-4852 WI-2): build `ox` and its two session adapters
 * from a trusted extraction of the eltmon/ox fork into `<extractDir>/bin/`,
 * and tell whether a build is ready.
 *
 * Imports only `node:*`: `sources.ts` imports this module and owns the per-id
 * paths, so this one takes explicit directories and throws its own
 * OxBuildError. A bare `go version` writes `~/.config/go/telemetry`, so every
 * `go` call must run with `oxBuildEnv`: `buildOx` always does, and callers of
 * `assertGoAvailable` and `oxBuildDownloads` must pass `goDir`
 * (`<packdir>/go`), or the probe writes into `HOME`. A build is ready only
 * when its marker, written last, names the trusted commit.
 */
import { execFile } from 'node:child_process';
import { access, constants, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const OX_BUILD_MARKER = '.overdeck-ox-build.json';
export const OX_BINARIES = ['ox', 'ox-adapter-claude-code', 'ox-adapter-codex'] as const;

const OX_BUILD_MARKER_VERSION = 1;
const BUILD_TIMEOUT_MS = 15 * 60_000;
const GO_PROBE_TIMEOUT_MS = 10_000;
const STDERR_TAIL_LINES = 20;
const GO_MISSING = 'pack sageox needs go on PATH (https://go.dev/dl/)';

export class OxBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OxBuildError';
  }
}

export interface OxBuildRunner {
  (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; timeout: number }): Promise<{ stdout: string }>;
}

const execFileAsync = promisify(execFile);

/** promisified execFile; stdin is closed at once so `go` never waits on a prompt. */
const execFileRunner: OxBuildRunner = async (cmd, args, opts) => {
  const pending = execFileAsync(cmd, args, { ...opts, maxBuffer: 16 * 1024 * 1024 });
  pending.child.stdin?.end();
  const { stdout } = await pending;
  return { stdout };
};

let defaultRunner: OxBuildRunner = execFileRunner;

/** Test seam (PAN-4852 WI-3): replace the default runner; `undefined` restores `execFile`. */
export function __setOxBuildRunnerForTests(run?: OxBuildRunner): void {
  defaultRunner = run ?? execFileRunner;
}

/** AD-5: Go's caches, module path and config (telemetry) all live under `goDir`. */
export function oxBuildEnv(goDir: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    GOCACHE: join(goDir, 'cache'),
    GOMODCACHE: join(goDir, 'mod'),
    GOPATH: join(goDir, 'path'),
    XDG_CONFIG_HOME: join(goDir, 'config'),
    GOFLAGS: '-modcacherw',
  };
}

/** The exact commands the build runs, with `cwd` = the extraction. */
export function oxBuildCommands(binDir: string): string[][] {
  return OX_BINARIES.map((name) => ['go', 'build', '-o', `${binDir}/${name}`, `./cmd/${name}`]);
}

/** Probe env: with `goDir` the AD-5 env, so a probe leaves `HOME` as it found it. */
function probeEnv(goDir: string | undefined): NodeJS.ProcessEnv {
  return goDir ? oxBuildEnv(goDir) : process.env;
}

/**
 * AD-9: returns `go version` stdout, or throws when `go` is not runnable. Runs
 * in the temp dir so a `go.mod` in the caller's cwd cannot trigger a toolchain
 * download.
 */
export async function assertGoAvailable(run: OxBuildRunner = defaultRunner, goDir?: string): Promise<string> {
  try {
    const { stdout } = await run('go', ['version'], { cwd: tmpdir(), env: probeEnv(goDir), timeout: GO_PROBE_TIMEOUT_MS });
    return stdout.trim();
  } catch {
    throw new OxBuildError(GO_MISSING);
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** `1.26`, `1.26.0`, `go1.24.1`, `go1.26rc1` → numeric parts; missing parts count as 0. */
function versionParts(version: string): number[] {
  return version
    .replace(/^go/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

function isOlder(host: string, required: string): boolean {
  const a = versionParts(host);
  const b = versionParts(required);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
}

/**
 * AD-8: what the build downloads. The module line appears when the extraction
 * has a `go.sum`; the toolchain line when `go env GOVERSION` is older than the
 * toolchain `go.mod` asks for (or cannot be read: the preview errs on
 * disclosing). That is the newer of its `go` and `toolchain` lines, the one
 * `GOTOOLCHAIN=auto` actually downloads.
 */
export async function oxBuildDownloads(extractDir: string, run: OxBuildRunner = defaultRunner, goDir?: string): Promise<string[]> {
  const downloads: string[] = [];
  if ((await readOptional(join(extractDir, 'go.sum'))) !== undefined) {
    downloads.push('Go modules listed in go.sum (proxy.golang.org)');
  }
  const goMod = await readOptional(join(extractDir, 'go.mod'));
  const goLine = goMod?.match(/^go\s+(\S+)\s*$/m)?.[1];
  const toolchainLine = goMod?.match(/^toolchain\s+go(\S+)\s*$/m)?.[1];
  const required = goLine && toolchainLine ? (isOlder(goLine, toolchainLine) ? toolchainLine : goLine) : (toolchainLine ?? goLine);
  if (!required) return downloads;
  let host = '';
  try {
    host = (
      await run('go', ['env', 'GOVERSION'], { cwd: tmpdir(), env: probeEnv(goDir), timeout: GO_PROBE_TIMEOUT_MS })
    ).stdout.trim();
  } catch {
    // Unknown host version: disclose the toolchain download.
  }
  if (!host || isOlder(host, required)) downloads.push(`Go toolchain go${required} (GOTOOLCHAIN=auto)`);
  return downloads;
}

/** AD-6: the marker parses, names `commit`, and `bin/ox` is executable. */
export async function isOxBuildReady(extractDir: string, commit: string): Promise<boolean> {
  const binDir = join(extractDir, 'bin');
  let marker: unknown;
  try {
    marker = JSON.parse(await readFile(join(binDir, OX_BUILD_MARKER), 'utf8'));
  } catch {
    return false;
  }
  if (!marker || typeof marker !== 'object') return false;
  const record = marker as Record<string, unknown>;
  if (record['version'] !== OX_BUILD_MARKER_VERSION || record['commit'] !== commit) return false;
  try {
    await access(join(binDir, 'ox'), constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function stderrTail(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  const text = typeof stderr === 'string' && stderr.trim() ? stderr : error instanceof Error ? error.message : String(error);
  return text.trimEnd().split('\n').slice(-STDERR_TAIL_LINES).join('\n');
}

/** Build the three binaries into `<extractDir>/bin/` (replacing it); on any failure `bin/` is removed. */
export async function buildOx(opts: { extractDir: string; commit: string; goDir: string; run?: OxBuildRunner }): Promise<void> {
  const run = opts.run ?? defaultRunner;
  const goVersion = await assertGoAvailable(run, opts.goDir);
  const binDir = join(opts.extractDir, 'bin');
  await rm(binDir, { recursive: true, force: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(opts.goDir, { recursive: true });
  const env = oxBuildEnv(opts.goDir);
  try {
    for (const [command, ...args] of oxBuildCommands(binDir)) {
      await run(command!, args, { cwd: opts.extractDir, env, timeout: BUILD_TIMEOUT_MS });
    }
  } catch (error) {
    await rm(binDir, { recursive: true, force: true });
    throw new OxBuildError(`pack sageox: go build failed: ${stderrTail(error)}`);
  }
  // The toolchain the build ran with (GOTOOLCHAIN=auto may have switched from the host go).
  let builtWith = goVersion;
  try {
    builtWith = (await run('go', ['version'], { cwd: opts.extractDir, env, timeout: GO_PROBE_TIMEOUT_MS })).stdout.trim() || goVersion;
  } catch {
    // Keep the host version; the build itself succeeded.
  }
  const marker = {
    version: OX_BUILD_MARKER_VERSION,
    commit: opts.commit,
    binaries: [...OX_BINARIES],
    goVersion: builtWith,
    builtAt: new Date().toISOString(),
  };
  await writeFile(join(binDir, OX_BUILD_MARKER), `${JSON.stringify(marker, null, 2)}\n`);
}
