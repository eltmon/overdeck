import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  VersionShipOperationError,
  type ShipFailureCode,
  type VersionShipDeps,
} from './version-ship.js';

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const MAX_EXPECT_FILE_BYTES = 1024 * 1024;
const REGEX_TIMEOUT_MS = 250;

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
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[redacted]')
    .replace(/\b(token|password|passwd|secret|api[_-]?key|private[_-]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .slice(-2_000);
}

function logDiagnostic(message: string): void {
  console.error(redactVersionShipDiagnostic(message));
}

function execFileResult(file: string, args: string[], cwd: string): Promise<ExecResult> {
  return new Promise(resolveResult => {
    execFile(file, args, { cwd, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolveResult({
        exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout,
        stderr,
      });
    });
  });
}

async function execFileOrThrow(
  file: string,
  args: string[],
  cwd: string,
  code: Extract<ShipFailureCode, 'commit-failed' | 'push-failed'>,
  safeMessage: string,
): Promise<ExecResult> {
  const result = await execFileResult(file, args, cwd);
  if (result.exitCode !== 0) {
    logDiagnostic(`[version-ship] ${file} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    throw new VersionShipOperationError(code, safeMessage);
  }
  return result;
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

export function buildVersionShipDeps(): VersionShipDeps {
  return {
    now: () => new Date().toISOString(),
    resolveFile: (root, path) => validateContainedPath(root, path, 'file'),
    resolveDirectory: (root, path) => validateContainedPath(root, path, 'directory'),
    writeVersion: writeJsonStringField,
    runCommand: async (command, cwd) => {
      const [file, ...args] = tokenizeCommand(command);
      return execFileResult(file, args, cwd);
    },
    readFile: readBoundedRegularFile,
    testPattern: testPatternInWorker,
    hasChanges: async (repoRoot, paths) => {
      const result = await execFileOrThrow(
        'git',
        ['status', '--porcelain', '--', ...paths],
        repoRoot,
        'commit-failed',
        'could not inspect declared version paths before commit',
      );
      return result.stdout.trim().length > 0;
    },
    commit: async (repoRoot, paths, message) => {
      await execFileOrThrow('git', ['add', '--', ...paths], repoRoot, 'commit-failed', 'could not stage declared version paths');
      await execFileOrThrow('git', ['commit', '-m', message], repoRoot, 'commit-failed', 'could not commit declared version paths');
    },
    push: async (repoRoot, targetBranch) => {
      await execFileOrThrow('git', ['check-ref-format', '--branch', targetBranch], repoRoot, 'push-failed', 'configured target branch is invalid');
      await execFileOrThrow('git', ['push', 'origin', `HEAD:${targetBranch}`], repoRoot, 'push-failed', `could not push version commit to ${targetBranch}`);
    },
    logDiagnostic,
  };
}
