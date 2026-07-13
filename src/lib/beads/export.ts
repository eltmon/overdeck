import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { resolveSharedBeadsDir } from '../bd-process-lock.js';

const execFileAsync = promisify(execFile);

export interface BeadsExportState {
  universe: 'all';
  sourceDoltHead: string;
  recordCount: number;
  exportedAt: string;
}

export interface ExportBeadsOptions {
  execute?: (args: readonly string[], cwd: string) => Promise<string>;
  beadsDir?: string;
  now?: () => Date;
}

export interface ExportBeadsResult {
  path: string;
  statePath: string;
  state: BeadsExportState;
}

async function defaultExecute(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('bd', [...args], { cwd, encoding: 'utf8', timeout: 120_000 });
  return stdout;
}

function doltHead(status: string): string | null {
  return /^Commit:\s*([0-9a-v]{7,40})\s*$/im.exec(status)?.[1] ?? null;
}

function recordsFromJsonl(raw: string): Array<Record<string, unknown>> {
  return raw.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function recordIds(records: Array<Record<string, unknown>>): string[] {
  return records.map((record) => String(record.id ?? '')).filter(Boolean).sort();
}

/** The only production writer for the derived recovery JSONL snapshot. */
export async function exportBeadsJsonl(workspacePath: string, options: ExportBeadsOptions = {}): Promise<ExportBeadsResult> {
  const execute = options.execute ?? defaultExecute;
  const beadsDir = options.beadsDir ?? await resolveSharedBeadsDir(workspacePath);
  await mkdir(beadsDir, { recursive: true });
  const target = join(beadsDir, 'issues.jsonl');
  const statePath = join(beadsDir, 'export-state.json');
  const token = `${process.pid}-${Date.now()}`;
  const temporary = join(beadsDir, `.issues.jsonl.${token}.tmp`);
  const temporaryState = join(beadsDir, `.export-state.${token}.tmp`);
  try {
    const status = await execute(['vc', 'status'], workspacePath);
    const sourceDoltHead = doltHead(status);
    if (!sourceDoltHead) throw new Error('Beads export refused because bd vc status did not report a Dolt commit.');

    await execute(['export', '--all', '-o', temporary], workspacePath);
    const raw = existsSync(temporary) ? await readFile(temporary, 'utf8') : '';
    const exported = recordsFromJsonl(raw);
    const listedRaw = await execute(['list', '--all', '--json', '--limit', '0'], workspacePath);
    const listedValue: unknown = JSON.parse(listedRaw || '[]');
    const listed = (Array.isArray(listedValue) ? listedValue : []) as Array<Record<string, unknown>>;

    const exportedIds = recordIds(exported);
    const listedIds = recordIds(listed);
    if (exported.length !== listed.length || JSON.stringify(exportedIds) !== JSON.stringify(listedIds)) {
      throw new Error(`Beads export verification failed in the all-record universe: export=${exported.length}, canonical=${listed.length}. The known-good snapshot was not replaced.`);
    }
    if (exported.length === 0 && existsSync(target) && (await readFile(target, 'utf8')).trim().length > 0) {
      throw new Error('Beads export refused to replace a non-empty known-good snapshot with an empty export. The Dolt database must be reconciled first.');
    }

    const state: BeadsExportState = {
      universe: 'all',
      sourceDoltHead,
      recordCount: exported.length,
      exportedAt: (options.now ?? (() => new Date()))().toISOString(),
    };
    await writeFile(temporaryState, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    // Publish data first and its provenance immediately after. Both files are
    // individually atomic; a reader verifies export-state before trusting it.
    await rename(temporary, target);
    await rename(temporaryState, statePath);
    return { path: target, statePath, state };
  } finally {
    await Promise.all([rm(temporary, { force: true }), rm(temporaryState, { force: true })]);
  }
}
