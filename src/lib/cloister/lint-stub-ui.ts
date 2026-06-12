/**
 * Stub-UI scanner (PAN-1500).
 *
 * Reads the PR diff for a workspace and emits structured findings for added
 * (+) lines that match the STUB_UI_PATTERNS catalog. The scanner restricts
 * inspection to frontend UI affordance files and degrades gracefully: any
 * internal failure returns an empty array and logs a non-fatal warning.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import {
  STUB_UI_PATTERNS,
  isStubUiFileInScope,
  type StubUiFinding,
} from './stub-ui-patterns.js';

export type { StubUiFinding };

const execAsync = promisify(exec);

interface ChangedFileEntry {
  path: string;
  status: string;
}

async function listChangedFiles(workspace: string, diffBase: string): Promise<ChangedFileEntry[]> {
  const { stdout } = await execAsync(
    `git diff --name-status "${diffBase}"...HEAD`,
    { cwd: workspace, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 },
  );

  const entries: ChangedFileEntry[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0]?.[0] ?? 'M';
    const path = parts[parts.length - 1] ?? '';
    if (!path) continue;
    entries.push({ path, status });
  }
  return entries;
}

/**
 * Parse a unified-diff hunk header and return the destination starting line.
 * Headers look like `@@ -3,5 +8,9 @@` or `@@ -1 +1 @@`.
 */
function parseHunkHeader(line: string): number | null {
  const match = line.match(/@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/**
 * Read the diff for a single file and yield every added line with its
 * destination line number. Uses `-U0` so there are no context lines to skip.
 */
async function* addedLinesForFile(
  workspace: string,
  diffBase: string,
  filePath: string,
): AsyncGenerator<{ lineNumber: number; content: string }> {
  const { stdout } = await execAsync(
    `git diff -U0 "${diffBase}"...HEAD -- "${filePath}"`,
    { cwd: workspace, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 },
  );

  let currentLine = 0;

  for (const rawLine of stdout.split('\n')) {
    if (rawLine.startsWith('@@')) {
      const parsed = parseHunkHeader(rawLine);
      if (parsed !== null) {
        currentLine = parsed;
      }
      continue;
    }

    if (rawLine.startsWith('+++')) continue;
    if (rawLine.startsWith('---')) continue;

    if (rawLine.startsWith('+')) {
      const content = rawLine.slice(1);
      yield { lineNumber: currentLine, content };
      currentLine += 1;
      continue;
    }

    if (rawLine.startsWith(' ')) {
      currentLine += 1;
      continue;
    }

    // Deleted lines do not advance the destination line counter.
  }
}

/**
 * Scan the PR diff in `workspace` against `diffBase` for stub-UI patterns.
 *
 * Returns a list of findings; never throws. Internal failures (git errors,
 * malformed hunks, missing workspace) log a warning and return [].
 */
export async function scanStubUi(workspace: string, diffBase: string): Promise<StubUiFinding[]> {
  try {
    const changedFiles = await listChangedFiles(workspace, diffBase);
    const findings: StubUiFinding[] = [];

    for (const { path, status } of changedFiles) {
      if (!isStubUiFileInScope(path, status)) continue;

      for await (const { lineNumber, content } of addedLinesForFile(workspace, diffBase, path)) {
        for (const pattern of STUB_UI_PATTERNS) {
          if (pattern.regex.test(content)) {
            findings.push({
              patternId: pattern.id,
              patternLabel: pattern.label,
              filePath: path,
              lineNumber,
              addedLine: content.trimEnd(),
              severity: pattern.severity,
            });
          }
        }
      }
    }

    return findings;
  } catch (err) {
    console.warn(
      `[scanStubUi] Failed to scan workspace ${workspace} against ${diffBase}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}
