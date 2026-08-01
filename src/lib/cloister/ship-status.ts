import type { ProjectConfig } from '../projects.js';
import { readIssueRecord, type PanIssueShipRecord } from '../pan-dir/record.js';
import type { UatGeneration } from '../overdeck/merge-sync.js';

const SHIP_RECORD_READ_CONCURRENCY = 4;

interface ShipStatusDeps {
  readRecord: typeof readIssueRecord;
}

const defaultDeps: ShipStatusDeps = {
  readRecord: readIssueRecord,
};

async function mapBounded<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

/** Load each unique issue record once with bounded async filesystem concurrency. */
export async function loadShipRecords(
  project: ProjectConfig,
  generations: readonly UatGeneration[],
  deps: ShipStatusDeps = defaultDeps,
): Promise<Map<string, PanIssueShipRecord | null>> {
  const issueIds = [...new Set(generations.flatMap(generation =>
    generation.members.map(member => member.issueId.toUpperCase())))] ;
  const records = new Map<string, PanIssueShipRecord | null>();
  await mapBounded(issueIds, SHIP_RECORD_READ_CONCURRENCY, async issueId => {
    records.set(issueId, (await deps.readRecord(project, issueId))?.pipeline.ship ?? null);
  });
  return records;
}

function latest(records: readonly PanIssueShipRecord[]): PanIssueShipRecord {
  return [...records].sort((left, right) => right.at.localeCompare(left.at))[0]!;
}

/**
 * Fold every member's durable record into one conservative generation verdict.
 * A generation cannot report passed while any member is missing, pending,
 * partial, failed, or records a different version.
 */
export function aggregateGenerationShipStatus(
  generation: UatGeneration,
  recordsByIssue: ReadonlyMap<string, PanIssueShipRecord | null>,
): PanIssueShipRecord | null {
  const records = generation.members.map(member => {
    const ship = recordsByIssue.get(member.issueId.toUpperCase());
    return ship?.batch === generation.name ? ship : null;
  });
  const matching = records.filter((record): record is PanIssueShipRecord => record !== null);
  if (matching.length === 0) {
    return generation.status === 'promoted'
      ? {
          status: 'pending',
          batch: generation.name,
          reason: 'no durable ship settlement was recorded for this promoted batch',
          at: generation.updatedAt,
        }
      : null;
  }
  if (matching.length !== records.length) {
    return {
      status: 'pending',
      batch: generation.name,
      reason: `${records.length - matching.length} member(s) have no durable ship settlement`,
      at: latest(matching).at,
    };
  }

  const failed = matching.filter(record => record.status === 'failed');
  if (failed.length > 0) return latest(failed);

  const partial = matching.filter(record => record.status === 'partial');
  if (partial.length > 0) {
    const newest = latest(partial);
    const paths = [...new Map(partial
      .flatMap(record => record.paths ?? [])
      .map(path => [path.path, path])).values()];
    return { ...newest, paths };
  }

  const pending = matching.filter(record => record.status === 'pending');
  if (pending.length > 0) return latest(pending);

  const versions = new Set(matching.map(record => record.version ?? ''));
  if (versions.size > 1) {
    return {
      status: 'partial',
      batch: generation.name,
      version: latest(matching).version,
      paths: [],
      reason: 'members record different shipped versions',
      at: latest(matching).at,
    };
  }
  return latest(matching);
}

/** Public aggregate omits operational error and reason strings. */
export function publicShipStatus(
  ship: PanIssueShipRecord | null,
): Omit<PanIssueShipRecord, 'error' | 'reason'> | null {
  if (!ship) return null;
  const { error: _error, reason: _reason, ...safe } = ship;
  return safe;
}
