import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
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
 * Registered project roots + OVERDECK_HOME, realpath'd. This is the file
 * door's allowlist — narrower than the open-any-path `shellOpenInEditor`
 * precedent, since this door also grants writes.
 */
async function resolveAllowedRoots(): Promise<string[]> {
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
 * Shared read+write validation: absolute path, markdown extension, resolves
 * (via realpath, so symlink escapes are caught) inside an allowlisted root,
 * and is an existing regular file. The write door never creates files
 * (PAN-3260 NonGoal) — this same existing-file check gates both.
 */
async function validateAndResolve(path: string): Promise<{ realPath: string }> {
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

  const allowedRoots = await resolveAllowedRoots();
  if (!allowedRoots.some((root) => isInsidePath(root, realPath))) {
    throw new PanRpcError({ message: 'Path is outside the allowed project roots', code: 'PATH_NOT_ALLOWED' });
  }

  const fileStat = await stat(realPath);
  if (!fileStat.isFile()) {
    throw new PanRpcError({ message: 'Path is not a file', code: 'FILE_NOT_FOUND' });
  }

  return { realPath };
}

function asPanRpcError(error: unknown, fallbackCode: string): PanRpcError {
  if (error instanceof PanRpcError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new PanRpcError({ message: `${fallbackCode}: ${message}`, code: fallbackCode });
}

export async function readFileAtPath(input: ReadFileAtPathInput): Promise<ReadFileAtPathResult> {
  const { realPath } = await validateAndResolve(input.path);
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
  };
}

export function readFileAtPathEffect(input: ReadFileAtPathInput): Effect.Effect<ReadFileAtPathResult, PanRpcError> {
  return Effect.tryPromise({
    try: () => readFileAtPath(input),
    catch: (error) => asPanRpcError(error, 'READ_FILE_AT_PATH_FAILED'),
  });
}

export async function writeFileAtPath(input: WriteFileAtPathInput): Promise<WriteFileAtPathResult> {
  const { realPath } = await validateAndResolve(input.path);

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
