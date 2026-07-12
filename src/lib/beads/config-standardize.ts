import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { resolveSharedBeadsDir } from '../bd-process-lock.js';
import { toDoltRemoteUrl } from './bootstrap.js';

const execFileAsync = promisify(execFile);

const PROJECT_IGNORE_LINES = [
  '.beads/dolt/',
  '.beads/embeddeddolt/',
  '.beads/dolt-server.*',
  '.beads/*.dolt',
  '.beads/backup/',
];
const BEADS_IGNORE_LINES = ['dolt/', 'embeddeddolt/', 'dolt-server.*', '*.dolt', 'backup/', 'redirect'];

async function appendMissing(path: string, required: readonly string[], dryRun: boolean): Promise<string[]> {
  const prior = existsSync(path) ? await readFile(path, 'utf8') : '';
  const present = new Set(prior.split('\n').map((line) => line.trim()));
  const missing = required.filter((line) => !present.has(line));
  if (!dryRun && missing.length > 0) {
    await mkdir(dirname(path), { recursive: true });
    const prefix = prior.length === 0 || prior.endsWith('\n') ? prior : `${prior}\n`;
    await writeFile(path, `${prefix}${missing.join('\n')}\n`);
  }
  return missing;
}

export interface StandardizeBeadsResult {
  removedNoDb: boolean;
  remoteMatches: boolean;
  expectedRemote: string;
  missingProjectIgnores: string[];
  missingBeadsIgnores: string[];
}

export async function standardizeBeadsConfig(projectPath: string, dryRun = false): Promise<StandardizeBeadsResult> {
  const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: projectPath, encoding: 'utf8' });
  const expectedRemote = toDoltRemoteUrl(stdout.trim());
  const beadsDir = await resolveSharedBeadsDir(projectPath);
  const configPath = join(beadsDir, 'config.yaml');
  let removedNoDb = false;
  let remoteMatches = true;
  if (existsSync(configPath)) {
    const raw = await readFile(configPath, 'utf8');
    const withoutLegacy = raw.split('\n').filter((line) => {
      const legacy = /^\s*no-db\s*:/.test(line);
      removedNoDb ||= legacy;
      return !legacy;
    }).join('\n');
    const configured = /^sync\.remote\s*:\s*(.+)\s*$/m.exec(withoutLegacy)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
    remoteMatches = !configured || configured === expectedRemote;
    if (!dryRun && removedNoDb) await writeFile(configPath, withoutLegacy);
  }
  const missingProjectIgnores = await appendMissing(join(projectPath, '.gitignore'), PROJECT_IGNORE_LINES, dryRun);
  const missingBeadsIgnores = await appendMissing(join(beadsDir, '.gitignore'), BEADS_IGNORE_LINES, dryRun);
  return { removedNoDb, remoteMatches, expectedRemote, missingProjectIgnores, missingBeadsIgnores };
}

export const BEADS_GITIGNORE_POLICY = { project: PROJECT_IGNORE_LINES, beads: BEADS_IGNORE_LINES } as const;
