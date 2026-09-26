/**
 * Builder ↔ critic pairing (.pan/drafts/pan-4223.md WI-18, FR-34, FR-35, D25).
 *
 * Pure: the caller supplies lane rows with their D7 iterations and newest
 * reports. Pairing is by iteration, not by row: the critics of builder
 * iteration n are the critic and verifier lanes of the same (run, key) whose
 * linked builder row has iteration n, so a `--reuse` respawn shares them. The
 * lanes API, the list enrichment, `pan lane show` and the lane door all read
 * pairings from here, so they agree.
 */
import type { LaneVerdict, WorkerReportVerdict } from '../agents/worker/report.js';
import type { LaneRole } from '../overdeck/conversations.js';

export interface PairingRow {
  id: number;
  name: string;
  run: string;
  key: string;
  role: LaneRole;
  /** D7, computed by the caller. */
  iteration: number;
  createdAt: string;
  /** LegacyConversation.criticOfConversationId. */
  criticOfId: number | null;
  /** D10 activity, or 'stopped' for archived rows. */
  activity: string;
  /** The newest report. */
  report: { status: 'done' | 'blocked' | 'failed'; verdict?: WorkerReportVerdict } | null;
}

export type VerdictState = LaneVerdict | 'pending';

export interface CriticSummary {
  id: number;
  name: string;
  role: 'critic' | 'verifier';
  /** The builder iteration this critic judged. */
  iteration: number;
  verdict: VerdictState;
  defects: number | null;
  file: string | null;
  activity: string;
}

export interface BuilderPairing {
  critics: CriticSummary[];
  latestVerdict: CriticSummary | null;
  answering: CriticSummary | null;
}

export type ChainStep =
  | { kind: 'builder'; iteration: number; state: string; ids: number[] }
  | { kind: 'critic'; critic: CriticSummary };

function isJudge(row: PairingRow): row is PairingRow & { role: 'critic' | 'verifier' } {
  return row.role === 'critic' || row.role === 'verifier';
}

function byCreation(a: PairingRow, b: PairingRow): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id;
}

/** The iteration of the builder row a critic judged; null without a link or when that row is absent. */
export function judgedIteration(critic: PairingRow, rowsById: ReadonlyMap<number, PairingRow>): number | null {
  if (critic.criticOfId === null) return null;
  return rowsById.get(critic.criticOfId)?.iteration ?? null;
}

function summarize(row: PairingRow & { role: 'critic' | 'verifier' }, iteration: number): CriticSummary {
  const verdict = row.report?.status === 'done' ? row.report.verdict : undefined;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    iteration,
    verdict: verdict?.value ?? 'pending',
    defects: verdict?.defects ?? null,
    file: verdict?.file ?? null,
    activity: row.activity,
  };
}

/** Critics of one (run, key) that judged `iteration`, oldest first. */
function criticsOf(run: string, key: string, iteration: number, rows: readonly PairingRow[]): Array<PairingRow & { role: 'critic' | 'verifier' }> {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return rows
    .filter(isJudge)
    .filter((row) => row.run === run && row.key === key && judgedIteration(row, rowsById) === iteration)
    .sort(byCreation);
}

export function pairBuilder(builder: PairingRow, rows: readonly PairingRow[]): BuilderPairing {
  const critics = criticsOf(builder.run, builder.key, builder.iteration, rows).map((row) => summarize(row, builder.iteration));
  let answering: CriticSummary | null = null;
  if (builder.iteration >= 2) {
    const created = Date.parse(builder.createdAt);
    const previous = criticsOf(builder.run, builder.key, builder.iteration - 1, rows)
      .filter((row) => Date.parse(row.createdAt) < created);
    const last = previous.at(-1);
    answering = last ? summarize(last, builder.iteration - 1) : null;
  }
  return { critics, latestVerdict: critics.at(-1) ?? null, answering };
}

export function criticChain(run: string, key: string, rows: readonly PairingRow[]): ChainStep[] {
  const builders = rows.filter((row) => row.role === 'builder' && row.run === run && row.key === key).sort(byCreation);
  const iterations = [...new Set(builders.map((row) => row.iteration))].sort((a, b) => a - b);
  const steps: ChainStep[] = [];
  for (const iteration of iterations) {
    const members = builders.filter((row) => row.iteration === iteration);
    const built = members.some((row) => row.report?.status === 'done');
    steps.push({ kind: 'builder', iteration, state: built ? 'built' : members.at(-1)!.activity, ids: members.map((row) => row.id) });
    for (const critic of criticsOf(run, key, iteration, rows)) steps.push({ kind: 'critic', critic: summarize(critic, iteration) });
  }
  return steps;
}

export function formatCriticChain(steps: readonly ChainStep[]): string {
  return steps.map((step) => {
    if (step.kind === 'builder') return `i${step.iteration} ${step.state}`;
    const { critic } = step;
    const defects = critic.defects === null ? '' : ` (${critic.defects} ${critic.defects === 1 ? 'defect' : 'defects'})`;
    return `${critic.role} ${critic.role === 'verifier' ? 'v' : 'c'}${critic.iteration}: ${critic.verdict}${defects}`;
  }).join(' → ');
}
