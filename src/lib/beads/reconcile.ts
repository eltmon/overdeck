import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ReconcileSourceName = 'local-dolt' | 'remote-dolt' | 'state-jsonl';
export type ReconcileRecord = Record<string, unknown> & { id: string };

export interface ReconcileDifference {
  id: string;
  classification: 'identical' | 'metadata-drift' | 'one-sided' | 'conflicting' | 'outside-export-scope';
  presentIn: ReconcileSourceName[];
}

export interface ReconcileInventory {
  differences: ReconcileDifference[];
  columns: string[];
  counts: Record<ReconcileSourceName, number>;
}

export interface ReconcileBeadsOptions {
  projectKey: string;
  projectPath: string;
  stateRoot: string;
  remoteUrl: string;
  date?: string;
  execute?: (file: string, args: readonly string[], cwd: string) => Promise<string>;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).sort().join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function mapRecords(records: ReconcileRecord[]): Map<string, ReconcileRecord> {
  return new Map(records.map((record) => [record.id, record]));
}

function withoutUpdatedAt(record: ReconcileRecord): ReconcileRecord {
  const { updated_at: _updated_at, ...rest } = record;
  return rest as ReconcileRecord;
}

function exportedByIssuesJsonl(record: ReconcileRecord): boolean {
  const kind = String(record.issue_type ?? record.type ?? 'issue').toLowerCase();
  return !['config', 'metadata', 'comment', 'dependency'].includes(kind);
}

export function compareBeadsSources(sources: Record<ReconcileSourceName, ReconcileRecord[]>): ReconcileInventory {
  const maps = Object.fromEntries(Object.entries(sources).map(([name, records]) => [name, mapRecords(records)])) as Record<ReconcileSourceName, Map<string, ReconcileRecord>>;
  const ids = Array.from(new Set(Object.values(sources).flatMap((records) => records.map((record) => record.id)))).sort();
  const columns = Array.from(new Set(Object.values(sources).flatMap((records) => records.flatMap((record) => Object.keys(record))))).sort();
  const differences = ids.map((id): ReconcileDifference => {
    const presentIn = (Object.keys(maps) as ReconcileSourceName[]).filter((name) => maps[name].has(id));
    const values = presentIn.map((name) => stable(maps[name].get(id)));
    const localOrRemote = maps['local-dolt'].get(id) ?? maps['remote-dolt'].get(id);
    const allValuesIdentical = new Set(values).size === 1;
    const valuesWithoutUpdatedAt = presentIn.map((name) => stable(withoutUpdatedAt(maps[name].get(id)!)));
    const onlyUpdatedAtDiffers = !allValuesIdentical && new Set(valuesWithoutUpdatedAt).size === 1;
    const classification = localOrRemote && !exportedByIssuesJsonl(localOrRemote) && !maps['state-jsonl'].has(id)
      ? 'outside-export-scope'
      : presentIn.length < 3
        ? 'one-sided'
        : onlyUpdatedAtDiffers
          ? 'metadata-drift'
          : allValuesIdentical
            ? 'identical'
            : 'conflicting';
    return { id, classification, presentIn };
  });
  return {
    differences,
    columns,
    counts: {
      'local-dolt': sources['local-dolt'].length,
      'remote-dolt': sources['remote-dolt'].length,
      'state-jsonl': sources['state-jsonl'].length,
    },
  };
}

async function defaultExecute(file: string, args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(file, [...args], { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

function parseList(raw: string): ReconcileRecord[] {
  const parsed: unknown = JSON.parse(raw || '[]');
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((record): record is ReconcileRecord => Boolean(record && typeof record === 'object' && typeof (record as { id?: unknown }).id === 'string'));
}

function parseJsonl(raw: string): ReconcileRecord[] {
  return raw.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as ReconcileRecord).filter((record) => typeof record.id === 'string');
}

export function reportMarkdown(options: ReconcileBeadsOptions, inventory: ReconcileInventory, heads: Record<'local' | 'remote', string>): string {
  const rows = inventory.differences.map((difference) => `| ${difference.id} | ${difference.classification} | ${difference.presentIn.join(', ')} |`).join('\n');
  const classificationOrder: ReconcileDifference['classification'][] = ['identical', 'metadata-drift', 'conflicting', 'one-sided', 'outside-export-scope'];
  const countsByClassification = classificationOrder.map((classification) => {
    const count = inventory.differences.filter((difference) => difference.classification === classification).length;
    return `- ${classification}: ${count}`;
  }).join('\n');
  return `# Beads reconciliation report — ${options.projectKey}\n\nThis is a read-only no-loss audit. It does not choose a winner, import, push, or delete any source.\n\n## Heads\n\n- Local Dolt: ${heads.local || 'unknown'}\n- Isolated remote refs/dolt/data clone: ${heads.remote || 'unknown'}\n\n## Summary by classification\n\n${countsByClassification}\n\n*metadata-drift* means the only differing field is \`updated_at\`. The v53 migration on 2026-07-12 bumped \`updated_at\` on every row, so these records are otherwise identical.\n\n## Full inventory\n\n- Local records: ${inventory.counts['local-dolt']}\n- Remote records: ${inventory.counts['remote-dolt']}\n- Derived JSONL records: ${inventory.counts['state-jsonl']}\n- Columns observed: ${inventory.columns.join(', ')}\n\n| Record | Classification | Present in |\n| --- | --- | --- |\n${rows || '| — | identical | no records |'}\n`;
}

/** Read-only, isolated three-source reconciliation. */
export async function reconcileBeads(options: ReconcileBeadsOptions) {
  const execute = options.execute ?? defaultExecute;
  const notesDir = join(options.stateRoot, 'notes');
  await mkdir(notesDir, { recursive: true });
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const safetyPath = join(notesDir, `beads-reconcile-${date}-local-safety.jsonl`);

  // Safety export is deliberately first, before the remote scratch clone or
  // any other operation can touch process state.
  await execute('bd', ['export', '--all', '-o', safetyPath], options.stateRoot);
  const local = parseJsonl(await readFile(safetyPath, 'utf8'));
  const localHead = await execute('bd', ['vc', 'status'], options.stateRoot);
  if (local.length !== parseList(await execute('bd', ['list', '--all', '--json', '--limit', '0'], options.stateRoot)).length) {
    throw new Error('Local safety export count verification failed; reconciliation stopped before remote access.');
  }

  const scratch = await mkdtemp(join(tmpdir(), `overdeck-beads-reconcile-${options.projectKey}-`));
  try {
    await execute('git', ['clone', '--no-checkout', options.remoteUrl, scratch], options.projectPath);
    await execute('git', ['fetch', 'origin', 'refs/dolt/data'], scratch);
    await execute('bd', ['bootstrap', '--yes', '--json'], scratch);
    const remote = parseList(await execute('bd', ['list', '--all', '--json', '--limit', '0'], scratch));
    const remoteHead = await execute('bd', ['vc', 'status'], scratch);
    const jsonlPath = join(options.stateRoot, '.beads', 'issues.jsonl');
    const stateJsonl = existsSync(jsonlPath) ? parseJsonl(await readFile(jsonlPath, 'utf8')) : [];
    const inventory = compareBeadsSources({ 'local-dolt': local, 'remote-dolt': remote, 'state-jsonl': stateJsonl });
    const head = (raw: string) => /^Commit:\s*([0-9a-f]{7,40})\s*$/im.exec(raw)?.[1] ?? '';
    const reportPath = join(notesDir, `beads-reconcile-${date}.md`);
    const report = reportMarkdown(options, inventory, { local: head(localHead), remote: head(remoteHead) });
    await writeFile(reportPath, report);
    const sha256 = createHash('sha256').update(report).digest('hex');
    const approvalPath = join(notesDir, `beads-reconcile-${date}.approval.json`);
    await writeFile(approvalPath, `${JSON.stringify({ approved: false, report: basename(reportPath), sha256 }, null, 2)}\n`);
    return { reportPath, approvalPath, sha256, inventory };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
