import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, posix as pathPosix, sep, win32 as pathWin32 } from 'node:path';

import { Effect } from 'effect';
import {
  PanRpcError,
  type ReadFileAtPathInput,
  type ReadFileAtPathResult,
  type WriteFileAtPathInput,
  type WriteFileAtPathResult,
} from '@overdeck/contracts';

import { listProjectsSync } from '../../../lib/projects.js';
import { OVERDECK_HOME } from '../../../lib/paths.js';
import { languageForPath } from './read-workspace-file.js';

/**
 * The file-at-path door (PAN-3260): `readFileAtPath` and `writeFileAtPath`
 * read or write one markdown file by absolute path, with no issueId. Reads
 * accept the home root + the write roots and report `writable`; writes
 * accept only the write roots and never create files (PAN-4583). Containment
 * is always evaluated on the realpath, never the lexical path.
 */

// 1 MiB — errors instead of truncating (PAN-3260 NFR-1): the internal
// markdown editor must never save a truncated buffer over a larger file.
const MAX_FILE_AT_PATH_BYTES = 1024 * 1024;
const MAX_PATH_LENGTH = 4096;
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);

function isInsidePath(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${sep}`);
}

/**
 * PAN-3260 review fix: recognize both POSIX (`/...`) and Windows
 * (`C:\...`, `\\...`) absolute paths regardless of the host platform's
 * ambient `path.isAbsolute`, since the dashboard server also ships as a
 * Windows desktop app. A path this accepts that doesn't actually resolve
 * on the running host still fails the realpath/containment checks below —
 * this only widens what counts as "absolute", not what's allowed.
 */
function isAbsolutePath(candidate: string): boolean {
  return pathWin32.isAbsolute(candidate) || pathPosix.isAbsolute(candidate);
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.endsWith('\n') ? normalized.slice(0, -1).split('\n').length : normalized.split('\n').length;
}

/**
 * Registered project roots + OVERDECK_HOME, realpath'd: the write roots.
 * writeFileAtPath accepts only these; readFileAtPath also accepts the home
 * root (PAN-4583).
 */
async function resolveWriteRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (const { config } of listProjectsSync()) {
    try {
      roots.push(await realpath(config.path));
    } catch {
      // Registered project path missing on disk — not an allowlist member.
    }
  }
  try {
    roots.push(await realpath(OVERDECK_HOME));
  } catch {
    // OVERDECK_HOME always exists in a running dashboard; ignore otherwise.
  }
  return roots;
}

/**
 * The operator's home directory, realpath'd — the extra read root (PAN-4583).
 * Every /ws/rpc caller holds the admin scope, which already grants a shell as
 * this user (docs/MARKDOWN-EDITOR-PANE.md, "Who can call this door"), so
 * reading markdown under $HOME grants no new access. Null when it is missing.
 */
async function resolveHomeRoot(): Promise<string | null> {
  try {
    return await realpath(homedir());
  } catch {
    return null;
  }
}

/**
 * Shared read+write validation: absolute path, markdown extension, resolves
 * (via realpath, so symlink escapes are caught) inside an allowlisted root,
 * and is an existing regular file. The write door never creates files
 * (PAN-3260 NonGoal) — this same existing-file check gates both. Containment
 * depends on `door`: a write must land inside a write root; a read may also
 * land inside the home root (PAN-4583).
 */
async function validateAndResolve(path: string, door: 'read' | 'write'): Promise<{ realPath: string; writable: boolean }> {
  if (path.length > MAX_PATH_LENGTH) {
    throw new PanRpcError({ message: `Path exceeds ${MAX_PATH_LENGTH} characters`, code: 'PATH_NOT_ALLOWED' });
  }
  if (!isAbsolutePath(path)) {
    throw new PanRpcError({ message: 'Path must be absolute', code: 'PATH_NOT_ALLOWED' });
  }
  const ext = extname(path).toLowerCase();
  if (!MARKDOWN_EXTENSIONS.has(ext)) {
    throw new PanRpcError({ message: `Unsupported file type: ${ext || '(none)'}`, code: 'UNSUPPORTED_FILE_TYPE' });
  }

  const realPath = await realpath(path).catch(() => {
    throw new PanRpcError({ message: 'File not found', code: 'FILE_NOT_FOUND' });
  });

  // PAN-3260 review fix: re-check the extension on the *resolved* path too.
  // The lexical check above only sees the caller-supplied path — a symlink
  // like `<root>/alias.md -> <root>/package.json` passes it but resolves to
  // a non-markdown file, which would otherwise let a write through.
  const realExt = extname(realPath).toLowerCase();
  if (!MARKDOWN_EXTENSIONS.has(realExt)) {
    throw new PanRpcError({ message: `Unsupported file type: ${realExt || '(none)'}`, code: 'UNSUPPORTED_FILE_TYPE' });
  }

  const writeRoots = await resolveWriteRoots();
  const writable = writeRoots.some((root) => isInsidePath(root, realPath));
  if (door === 'write' && !writable) {
    throw new PanRpcError({ message: 'Path is outside the allowed project roots', code: 'PATH_NOT_ALLOWED' });
  }
  if (door === 'read' && !writable) {
    const homeRoot = await resolveHomeRoot();
    if (homeRoot === null || !isInsidePath(homeRoot, realPath)) {
      throw new PanRpcError({
        message: 'Path is outside your home directory and the registered project roots',
        code: 'PATH_NOT_ALLOWED',
      });
    }
  }

  const fileStat = await stat(realPath);
  if (!fileStat.isFile()) {
    throw new PanRpcError({ message: 'Path is not a file', code: 'FILE_NOT_FOUND' });
  }

  return { realPath, writable };
}

function asPanRpcError(error: unknown, fallbackCode: string): PanRpcError {
  if (error instanceof PanRpcError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new PanRpcError({ message: `${fallbackCode}: ${message}`, code: fallbackCode });
}

export async function readFileAtPath(input: ReadFileAtPathInput): Promise<ReadFileAtPathResult> {
  const { realPath, writable } = await validateAndResolve(input.path, 'read');
  const fileStat = await stat(realPath);
  if (fileStat.size > MAX_FILE_AT_PATH_BYTES) {
    throw new PanRpcError({ message: `File exceeds ${MAX_FILE_AT_PATH_BYTES} bytes`, code: 'FILE_TOO_LARGE' });
  }

  const text = await readFile(realPath, 'utf8');
  return {
    text,
    lang: languageForPath(realPath),
    mtimeMs: fileStat.mtimeMs,
    totalLines: countLines(text),
    writable,
  };
}

export function readFileAtPathEffect(input: ReadFileAtPathInput): Effect.Effect<ReadFileAtPathResult, PanRpcError> {
  return Effect.tryPromise({
    try: () => readFileAtPath(input),
    catch: (error) => asPanRpcError(error, 'READ_FILE_AT_PATH_FAILED'),
  });
}

export async function writeFileAtPath(input: WriteFileAtPathInput): Promise<WriteFileAtPathResult> {
  const { realPath } = await validateAndResolve(input.path, 'write');

  if (input.expectedMtimeMs !== undefined) {
    const current = await stat(realPath);
    if (current.mtimeMs !== input.expectedMtimeMs) {
      throw new PanRpcError({ message: 'File changed on disk since it was read', code: 'WRITE_CONFLICT' });
    }
  }

  await writeFile(realPath, input.content, 'utf8');
  const updated = await stat(realPath);
  return { mtimeMs: updated.mtimeMs };
}

export function writeFileAtPathEffect(input: WriteFileAtPathInput): Effect.Effect<WriteFileAtPathResult, PanRpcError> {
  return Effect.tryPromise({
    try: () => writeFileAtPath(input),
    catch: (error) => asPanRpcError(error, 'WRITE_FILE_AT_PATH_FAILED'),
  });
}
