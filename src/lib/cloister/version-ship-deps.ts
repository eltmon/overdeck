import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import type { VersionShipDeps } from './version-ship.js';

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

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
  if (quote !== null) throw new Error(`version_sync.command has an unclosed ${quote} quote`);
  push();
  if (tokens.length === 0) throw new Error('version_sync.command is empty');
  return tokens;
}

function execFileResult(file: string, args: string[], cwd: string): Promise<ExecResult> {
  return new Promise(resolve => {
    execFile(file, args, { cwd, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout,
        stderr,
      });
    });
  });
}

async function execFileOrThrow(file: string, args: string[], cwd: string): Promise<ExecResult> {
  const result = await execFileResult(file, args, cwd);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `${file} exited ${result.exitCode}`;
    throw new Error(detail);
  }
  return result;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeJsonStringField(path: string, jsonField: string, version: string): Promise<void> {
  const content = await readFile(path, 'utf-8');
  const fieldPattern = new RegExp(`("${escapeRegex(jsonField)}"\\s*:\\s*")([^"]*)(")`);
  if (!fieldPattern.test(content)) {
    throw new Error(`${path}: JSON string field "${jsonField}" was not found`);
  }
  const updated = content.replace(fieldPattern, `$1${version}$3`);
  if (updated !== content) await writeFile(path, updated, 'utf-8');
}

export function buildVersionShipDeps(): VersionShipDeps {
  return {
    now: () => new Date().toISOString(),
    writeVersion: writeJsonStringField,
    runCommand: async (command, cwd) => {
      const [file, ...args] = tokenizeCommand(command);
      return execFileResult(file, args, cwd);
    },
    readFile: path => readFile(path, 'utf-8'),
    hasChanges: async (repoRoot, paths) => {
      const result = await execFileOrThrow('git', ['status', '--porcelain', '--', ...paths], repoRoot);
      return result.stdout.trim().length > 0;
    },
    commit: async (repoRoot, paths, message) => {
      await execFileOrThrow('git', ['add', '--', ...paths], repoRoot);
      await execFileOrThrow('git', ['commit', '-m', message], repoRoot);
    },
    push: async repoRoot => {
      await execFileOrThrow('git', ['push'], repoRoot);
    },
  };
}
