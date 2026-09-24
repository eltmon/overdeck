/**
 * The flywheel's two plan-home files (PAN-3964 FR-3, D1).
 *
 *   <planHome>/.pan/flywheel/state.md   cumulative memory the loop maintains
 *   <planHome>/.pan/flywheel/report.md  the report the loop writes when it stops
 *
 * The loop writes and commits both; the dashboard and CLI only read them.
 * Ported from v1 `readFlywheelState` (docs/FLYWHEEL-STATE.md), with the plan
 * home as an argument instead of `process.cwd()`.
 */

import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export const FLYWHEEL_STATE_RELATIVE_PATH = '.pan/flywheel/state.md';
export const FLYWHEEL_REPORT_RELATIVE_PATH = '.pan/flywheel/report.md';

export interface FlywheelFilePayload {
  exists: boolean;
  /** The path relative to the plan home, for display. */
  path: string;
  content: string | null;
  /** ISO mtime, or null when the file does not exist. */
  lastModified: string | null;
}

/** Resolve `relativePath` under `planHome`; throws when it escapes. */
function resolveUnderPlanHome(planHome: string, relativePath: string): string {
  const root = resolve(planHome);
  const absolute = resolve(root, relativePath);
  const rel = relative(root, absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Flywheel file path escapes the plan home: ${relativePath}`);
  }
  return absolute;
}

export async function readFlywheelFile(planHome: string, relativePath: string): Promise<FlywheelFilePayload> {
  const absolute = resolveUnderPlanHome(planHome, relativePath);
  try {
    const [content, info] = await Promise.all([readFile(absolute, 'utf8'), stat(absolute)]);
    return { exists: true, path: relativePath, content, lastModified: info.mtime.toISOString() };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { exists: false, path: relativePath, content: null, lastModified: null };
    }
    throw error;
  }
}

export function readFlywheelStateFile(planHome: string): Promise<FlywheelFilePayload> {
  return readFlywheelFile(planHome, FLYWHEEL_STATE_RELATIVE_PATH);
}

export function readFlywheelReportFile(planHome: string): Promise<FlywheelFilePayload> {
  return readFlywheelFile(planHome, FLYWHEEL_REPORT_RELATIVE_PATH);
}
