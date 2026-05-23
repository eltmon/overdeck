import { open, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

import { Effect } from 'effect';
import { PanRpcError, type ReadWorkspaceFileInput, type ReadWorkspaceFileResult } from '@panctl/contracts';

import { resolveProjectFromIssue } from '../../../lib/projects.js';
import { getWorkspacePathForIssue } from '../workspace-paths.js';

const MAX_WORKSPACE_FILE_BYTES = 256 * 1024;
const DEFAULT_CONTEXT_LINES = 10;

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.bash': 'bash',
  '.c': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.go': 'go',
  '.h': 'c',
  '.hpp': 'cpp',
  '.html': 'html',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'jsx',
  '.kt': 'kotlin',
  '.md': 'markdown',
  '.mdx': 'mdx',
  '.php': 'php',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sh': 'bash',
  '.sql': 'sql',
  '.svelte': 'svelte',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.vue': 'vue',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zsh': 'bash',
};

function isInsidePath(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${sep}`);
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.endsWith('\n')
    ? normalized.slice(0, -1).split('\n')
    : normalized.split('\n');
}

function validateIntegerAtLeast(value: number | undefined, name: string, min: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min) {
    throw new PanRpcError({ message: `${name} must be an integer greater than or equal to ${min}`, code: 'INVALID_ARGUMENT' });
  }
  return value;
}

function selectRequestedLines(text: string, line: number | undefined, contextLines: number | undefined): { text: string; totalLines: number } {
  const lines = splitLines(text);
  const totalLines = lines.length;
  if (!line) return { text, totalLines };

  const context = contextLines ?? DEFAULT_CONTEXT_LINES;
  const start = Math.max(1, line - context);
  const end = Math.min(totalLines, line + context);
  return {
    text: lines.slice(start - 1, end).join('\n'),
    totalLines,
  };
}

async function readCappedFile(path: string, size: number): Promise<{ text: string; truncated: boolean }> {
  const bytesToRead = Math.min(size, MAX_WORKSPACE_FILE_BYTES + 1);
  const buffer = Buffer.alloc(bytesToRead);
  const file = await open(path, 'r');
  try {
    const { bytesRead } = await file.read(buffer, 0, bytesToRead, 0);
    const truncated = size > MAX_WORKSPACE_FILE_BYTES || bytesRead > MAX_WORKSPACE_FILE_BYTES;
    const text = buffer.subarray(0, Math.min(bytesRead, MAX_WORKSPACE_FILE_BYTES)).toString('utf8');
    return { text, truncated };
  } finally {
    await file.close();
  }
}

function asPanRpcError(error: unknown): PanRpcError {
  if (error instanceof PanRpcError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new PanRpcError({ message: `Failed to read workspace file: ${message}`, code: 'READ_WORKSPACE_FILE_FAILED' });
}

export function languageForPath(path: string): string {
  return LANGUAGE_BY_EXTENSION[extname(path).toLowerCase()] ?? 'plaintext';
}

export async function readWorkspaceFile(input: ReadWorkspaceFileInput): Promise<ReadWorkspaceFileResult> {
  const line = validateIntegerAtLeast(input.line, 'line', 1);
  const contextLines = validateIntegerAtLeast(input.contextLines, 'contextLines', 0);
  const project = await Effect.runPromise(resolveProjectFromIssue(input.issueId));
  if (!project) {
    throw new PanRpcError({ message: `No project found for ${input.issueId}`, code: 'WORKSPACE_NOT_FOUND' });
  }

  const { workspacePath } = getWorkspacePathForIssue(project.projectPath, input.issueId);
  const workspaceRoot = await realpath(workspacePath).catch(() => {
    throw new PanRpcError({ message: `Workspace not found for ${input.issueId}`, code: 'WORKSPACE_NOT_FOUND' });
  });
  const resolvedPath = resolve(workspaceRoot, input.relativePath);
  if (!isInsidePath(workspaceRoot, resolvedPath)) {
    throw new PanRpcError({ message: 'Path is outside the workspace', code: 'PATH_OUTSIDE_WORKSPACE' });
  }

  const realPath = await realpath(resolvedPath).catch(() => {
    throw new PanRpcError({ message: 'Workspace file not found', code: 'FILE_NOT_FOUND' });
  });
  if (!isInsidePath(workspaceRoot, realPath)) {
    throw new PanRpcError({ message: 'Path is outside the workspace', code: 'PATH_OUTSIDE_WORKSPACE' });
  }

  const fileStat = await stat(realPath);
  if (!fileStat.isFile()) {
    throw new PanRpcError({ message: 'Workspace path is not a file', code: 'FILE_NOT_FOUND' });
  }

  const { text, truncated } = await readCappedFile(realPath, fileStat.size);
  const selected = selectRequestedLines(text, line, contextLines);
  return {
    text: selected.text,
    lang: languageForPath(realPath),
    truncated,
    totalLines: selected.totalLines,
  };
}

export function readWorkspaceFileEffect(input: ReadWorkspaceFileInput): Effect.Effect<ReadWorkspaceFileResult, PanRpcError> {
  return Effect.tryPromise({
    try: () => readWorkspaceFile(input),
    catch: asPanRpcError,
  });
}
