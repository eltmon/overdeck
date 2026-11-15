/**
 * PAN-5349 O-D15: when `pan integrate file-manager` installed the right-click
 * "Open in Overdeck" entry, check that what it recorded still exists: the
 * `pan` it runs and every file it wrote. Registry keys are not checked.
 * No state file means no check.
 */
import { access, constants } from 'node:fs/promises';

import { readFileManagerState, type FileManagerState } from '../../lib/integrations/file-manager.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-pan-path.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

export interface FileManagerCheckDeps {
  readState: () => Promise<FileManagerState | null>;
  exists: (path: string) => Promise<boolean>;
  isExecutable: (path: string) => Promise<boolean>;
}

const defaultDeps: FileManagerCheckDeps = {
  readState: () => readFileManagerState(),
  exists: (path) => canAccess(path, constants.F_OK),
  isExecutable: (path) => canAccess(path, constants.X_OK),
};

const NAME = 'File-manager integration';

export async function checkFileManagerIntegration(overrides: Partial<FileManagerCheckDeps> = {}): Promise<CheckResult | null> {
  const deps = { ...defaultDeps, ...overrides };
  const state = await deps.readState();
  if (!state) return null;
  let missing: string | null = (await deps.isExecutable(state.panPath)) ? null : state.panPath;
  for (const file of state.files) {
    if (missing) break;
    if (!(await deps.exists(file))) missing = file;
  }
  if (missing) {
    return { name: NAME, status: 'warn', message: `File-manager integration is stale: ${missing}`, fix: 'pan integrate file-manager' };
  }
  return { name: NAME, status: 'ok', message: `Open in Overdeck runs ${state.panPath}` };
}
