import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import { redactSensitiveText } from '../secret-redaction.js';
import {
  VersionShipOperationError,
  type ShipFailureCode,
  type VersionShipDeps,
} from './version-ship.js';
import { versionShipGitArgs, versionShipGitEnv } from './version-ship-git.js';

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const MAX_EXPECT_FILE_BYTES = 1024 * 1024;
const REGEX_TIMEOUT_MS = 250;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  const push = () => {
    if (current.length === 0) return;
    tokens.push(current);
    current = '';
  };

  for (const character of command) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (quote !== null) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      push();
    } else {
      current += character;
    }
  }

  if (escaped) current += '\\';
  if (quote !== null) throw new VersionShipOperationError('path-validation-failed', 'version_sync.command has an unclosed quote');
  push();
  if (tokens.length === 0) throw new VersionShipOperationError('path-validation-failed', 'version_sync.command is empty');
  return tokens;
}

export function redactVersionShipDiagnostic(value: string): string {
  return redactSensitiveText(value)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]')
    .slice(-2_000);
}

function logDiagnostic(message: string): void {
  console.error(redactVersionShipDiagnostic(message));
}

function execGitResult(args: string[], cwd: string): Promise<ExecResult> {
  return new Promise(resolveResult => {
    execFile('git', versionShipGitArgs(args), {
      cwd,
      encoding: 'utf-8',
      env: versionShipGitEnv(),
      maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolveResult({
        exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout,
        stderr,
      });
    });
  });
}

async function execGitOrThrow(
  args: string[],
  cwd: string,
  code: Extract<ShipFailureCode, 'commit-failed' | 'push-failed'>,
  safeMessage: string,
): Promise<ExecResult> {
  const result = await execGitResult(args, cwd);
  if (result.exitCode !== 0) {
    logDiagnostic(`[version-ship] git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    throw new VersionShipOperationError(code, safeMessage);
  }
  return result;
}

function dockerHostEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['DOCKER_CONFIG', 'DOCKER_HOST', 'HOME', 'PATH', 'XDG_RUNTIME_DIR']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function runDocker(args: string[], cwd: string, timeout: number): Promise<ExecResult> {
  return new Promise(resolveResult => {
    execFile('docker', args, {
      cwd,
      encoding: 'utf-8',
      env: dockerHostEnv(),
      killSignal: 'SIGKILL',
      maxBuffer: 16 * 1024 * 1024,
      timeout,
    }, (error, stdout, stderr) => {
      resolveResult({
        exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout,
        stderr,
      });
    });
  });
}

async function runSandboxedCommand(
  command: string,
  cwd: string,
  projectRoot: string,
  image: string,
  runDockerCommand: typeof runDocker = runDocker,
): Promise<ExecResult> {
  const [file, ...commandArgs] = tokenizeCommand(command);
  const commandRelative = relative(projectRoot, cwd);
  const containerCwd = commandRelative === ''
    ? '/workspace'
    : `/workspace/${commandRelative.split(sep).join('/')}`;
  const runtimeDir = await mkdtemp(join(tmpdir(), 'overdeck-version-ship-command-'));
  const cidFile = join(runtimeDir, 'container.cid');
  const uid = typeof process.getuid === 'function' ? process.getuid() : 65534;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 65534;

  try {
    return await runDockerCommand([
      'run', '--rm', '--init',
      '--cidfile', cidFile,
      '--pull', 'never',
      '--network', 'none',
      '--read-only',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--pids-limit', '256',
      '--memory', '2g',
      '--user', `${uid}:${gid}`,
      '--mount', `type=bind,src=${projectRoot},dst=/workspace,rw`,
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=67108864',
      '--workdir', containerCwd,
      '--env', 'CI=1',
      '--env', 'HOME=/tmp',
      '--env', 'TMPDIR=/tmp',
      image,
      file,
      ...commandArgs,
    ], projectRoot, COMMAND_TIMEOUT_MS);
  } finally {
    const containerId = await readFile(cidFile, 'utf-8').catch(() => '');
    if (containerId.trim()) {
      await runDockerCommand(['rm', '-f', containerId.trim()], projectRoot, 30_000).catch(() => ({ exitCode: 1, stdout: '', stderr: '' }));
    }
    await rm(runtimeDir, { recursive: true, force: true });
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function validateContainedPath(
  projectRoot: string,
  declaredPath: string,
  expected: 'file' | 'directory',
): Promise<string> {
  if (isAbsolute(declaredPath)) {
    throw new VersionShipOperationError('path-validation-failed', `version_sync path must be relative: ${declaredPath}`);
  }
  const root = await realpath(projectRoot);
  const absolute = resolve(root, declaredPath);
  const rel = relative(root, absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`) || (expected === 'file' && rel === '')) {
    throw new VersionShipOperationError('path-validation-failed', `version_sync path escapes the prepared project tree: ${declaredPath}`);
  }

  let current = root;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    const info = await lstat(current).catch(() => null);
    if (!info) {
      throw new VersionShipOperationError('path-validation-failed', `version_sync path does not exist: ${declaredPath}`);
    }
    if (info.isSymbolicLink()) {
      throw new VersionShipOperationError('path-validation-failed', `version_sync path contains a symlink: ${declaredPath}`);
    }
  }

  const final = await lstat(absolute);
  if (expected === 'file' ? !final.isFile() : !final.isDirectory()) {
    throw new VersionShipOperationError('path-validation-failed', `version_sync path is not a regular ${expected}: ${declaredPath}`);
  }
  const canonical = await realpath(absolute);
  const canonicalRelative = relative(root, canonical);
  if (canonicalRelative === '..' || canonicalRelative.startsWith(`..${sep}`)) {
    throw new VersionShipOperationError('path-validation-failed', `version_sync path resolves outside the prepared project tree: ${declaredPath}`);
  }
  return canonical;
}

async function writeJsonStringField(path: string, jsonField: string, version: string): Promise<void> {
  const handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new VersionShipOperationError('path-validation-failed', 'version_sync set target is not a regular file');
    const content = await handle.readFile('utf-8');
    const fieldPattern = new RegExp(`("${escapeRegex(jsonField)}"\\s*:\\s*")([^"]*)(")`);
    if (!fieldPattern.test(content)) {
      throw new VersionShipOperationError('path-validation-failed', `JSON string field was not found: ${jsonField}`);
    }
    const updated = content.replace(fieldPattern, `$1${version}$3`);
    if (updated !== content) {
      await handle.truncate(0);
      await handle.write(updated, 0, 'utf-8');
      await handle.sync();
    }
  } finally {
    await handle.close();
  }
}

async function readBoundedRegularFile(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new VersionShipOperationError('path-validation-failed', 'version_sync expect target is not a regular file');
    if (info.size > MAX_EXPECT_FILE_BYTES) {
      throw new VersionShipOperationError(
        'path-validation-failed',
        `version_sync expect target exceeds ${MAX_EXPECT_FILE_BYTES} bytes`,
      );
    }
    return handle.readFile('utf-8');
  } finally {
    await handle.close();
  }
}

function testPatternInWorker(pattern: string, content: string): Promise<boolean> {
  return new Promise((resolveResult, reject) => {
    const worker = new Worker(
      `const { parentPort, workerData } = require('node:worker_threads');\n` +
      `try { parentPort.postMessage({ ok: true, matched: new RegExp(workerData.pattern).test(workerData.content) }); }\n` +
      `catch (error) { parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }`,
      { eval: true, workerData: { pattern, content } },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new VersionShipOperationError('path-validation-failed', 'version_sync expectation exceeded the evaluation time limit'));
    }, REGEX_TIMEOUT_MS);
    worker.once('message', (result: { ok: boolean; matched?: boolean; error?: string }) => {
      clearTimeout(timer);
      void worker.terminate();
      if (result.ok) resolveResult(result.matched === true);
      else reject(new VersionShipOperationError('path-validation-failed', 'version_sync expectation could not be evaluated'));
    });
    worker.once('error', error => {
      clearTimeout(timer);
      logDiagnostic(`[version-ship] regex worker failed: ${error.message}`);
      reject(new VersionShipOperationError('path-validation-failed', 'version_sync expectation could not be evaluated'));
    });
  });
}

export interface BuildVersionShipDepsOptions {
  runDocker?: typeof runDocker;
}

export function buildVersionShipDeps(options: BuildVersionShipDepsOptions = {}): VersionShipDeps {
  return {
    now: () => new Date().toISOString(),
    resolveFile: (root, path) => validateContainedPath(root, path, 'file'),
    resolveDirectory: (root, path) => validateContainedPath(root, path, 'directory'),
    writeVersion: writeJsonStringField,
    runCommand: (command, cwd, projectRoot, image) => runSandboxedCommand(
      command,
      cwd,
      projectRoot,
      image,
      options.runDocker ?? runDocker,
    ),
    readFile: readBoundedRegularFile,
    testPattern: testPatternInWorker,
    hasChanges: async (repoRoot, paths) => {
      const result = await execGitOrThrow(
        ['status', '--porcelain', '--', ...paths],
        repoRoot,
        'commit-failed',
        'could not inspect declared version paths before commit',
      );
      return result.stdout.trim().length > 0;
    },
    commit: async (repoRoot, paths, message) => {
      await execGitOrThrow(['add', '--', ...paths], repoRoot, 'commit-failed', 'could not stage declared version paths');
      await execGitOrThrow(['commit', '-m', message], repoRoot, 'commit-failed', 'could not commit declared version paths');
    },
    push: async (repoRoot, targetBranch) => {
      await execGitOrThrow(['check-ref-format', '--branch', targetBranch], repoRoot, 'push-failed', 'configured target branch is invalid');
      await execGitOrThrow(['push', 'origin', `HEAD:${targetBranch}`], repoRoot, 'push-failed', `could not push version commit to ${targetBranch}`);
    },
    logDiagnostic,
  };
}
