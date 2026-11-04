/**
 * Lane list fields for the conversation list (PAN-4223 WI-5, WI-20; PAN-5005).
 *
 * `laneFieldsByRun` pairs over `listAllLaneRows` (local and remote lanes), so
 * it returns the same report, iteration and verdict fields for a remote lane
 * that `pan lane list` already shows. `conversation-list.ts` uses it for
 * local rows; `conversation-list-merged.ts` uses it to stamp remote stand-in
 * rows. Must not import `views.ts` or `conversation-list.ts` (no import cycle).
 */
import { linkedConversationName } from '@overdeck/contracts';

import { latestWorkerReport, type WorkerReport, type WorkerReportStatus } from '../agents/worker/report.js';
import { withConcurrencyLimit } from '../concurrency.js';
import { laneIterations } from './iteration.js';
import { listAllLaneRows, type LaneRow } from './lane-rows.js';
import { pairBuilder, type PairingRow, type VerdictState } from './pairing.js';

const LANE_FIELDS_CONCURRENCY = 8;

/** The lane fields a conversation-list row carries (PAN-4223 WI-5, WI-20; PAN-5005). */
export interface LaneListFields {
  laneReport: { seq: number; at: string; status: WorkerReportStatus; verdict: string | null } | null;
  laneIteration: number;
  /** Critic and verifier lanes only. */
  laneVerdict?: { value: VerdictState; defects: number | null };
  /** Builder lanes only. */
  laneLatestVerdict?: { value: VerdictState; defects: number | null; criticId: number | null; criticRoute: string } | null;
}

/** The `/conv/<key>` of a lane: its id here, its linked name on another machine. */
function routeOf(row: LaneRow): string {
  return row.remote ? linkedConversationName(row.remote.facts.environmentId, row.name) : String(row.id);
}

function pairingActivity(row: LaneRow): string {
  if (row.archivedAt !== null) return 'stopped';
  return row.local ? row.local.status : (row.remote?.mirror?.activity ?? 'stopped');
}

/** Report, iteration and verdict fields for every lane of `runs`, local and remote, keyed by lane name. */
export async function laneFieldsByRun(runs: readonly string[]): Promise<Map<string, LaneListFields>> {
  const fields = new Map<string, LaneListFields>();
  const unique = [...new Set(runs)];
  if (unique.length === 0) return fields;
  const context = (await Promise.all(unique.map((run) => listAllLaneRows({ run })))).flat();
  const iterations = laneIterations(context);
  const reports = new Map<string, WorkerReport | null>();
  await withConcurrencyLimit(context.map((row) => async () => {
    reports.set(row.name, await latestWorkerReport(`conv-${row.name}`));
  }), LANE_FIELDS_CONCURRENCY);
  const rowsByName = new Map(context.map((row) => [row.name, row]));
  const pairingRows = context.map((row): PairingRow => {
    const report = reports.get(row.name) ?? null;
    return {
      id: row.id,
      name: row.name,
      run: row.run,
      key: row.key,
      role: row.role,
      iteration: iterations.get(row.name) ?? 1,
      createdAt: row.createdAt,
      criticOfName: row.criticOfName,
      activity: pairingActivity(row),
      report: report ? { status: report.status, ...(report.verdict ? { verdict: report.verdict } : {}) } : null,
    };
  });
  for (const pairing of pairingRows) {
    const report = reports.get(pairing.name) ?? null;
    const entry: LaneListFields = {
      laneReport: report ? { seq: report.seq, at: report.at, status: report.status, verdict: report.verdict?.value ?? null } : null,
      laneIteration: pairing.iteration,
    };
    if (pairing.role === 'critic' || pairing.role === 'verifier') {
      const verdict = report?.status === 'done' ? report.verdict : undefined;
      entry.laneVerdict = { value: (verdict?.value ?? 'pending') as VerdictState, defects: verdict?.defects ?? null };
    } else if (pairing.role === 'builder') {
      const latest = pairBuilder(pairing, pairingRows).latestVerdict;
      const critic = latest ? rowsByName.get(latest.name) : undefined;
      entry.laneLatestVerdict = latest && critic
        ? { value: latest.verdict, defects: latest.defects, criticId: latest.id, criticRoute: routeOf(critic) }
        : null;
    }
    fields.set(pairing.name, entry);
  }
  return fields;
}
