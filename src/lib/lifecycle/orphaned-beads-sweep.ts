import { createBeadsResolver } from '../beads/resolver.js';
import { formatMutationBatchFailure, runMutationBatch } from '../beads/writer.js';

export interface SweepResult {
  ok: boolean;
  closedIds: string[];
  skipped: number;
  error?: string;
}

export interface SweepOrphanedBeadsOptions {
  beadsCwd: string;
  issueId: string;
  reason: string;
  dryRun?: boolean;
}

const SWEEPABLE_STATUSES = new Set(['open', 'in_progress']);

function isSweepable(status: string): boolean {
  return SWEEPABLE_STATUSES.has(status);
}

export async function sweepOrphanedBeads(options: SweepOrphanedBeadsOptions): Promise<SweepResult> {
  const { beadsCwd, issueId, reason, dryRun } = options;

  const resolver = createBeadsResolver(beadsCwd);
  const readResult = await resolver.getBeadsForIssue(issueId);

  if (!readResult.ok) {
    return {
      ok: false,
      closedIds: [],
      skipped: 0,
      error: readResult.reason,
    };
  }

  const beads = readResult.value;
  const toClose = beads.filter((bead) => isSweepable(bead.status));
  const skipped = beads.length - toClose.length;

  if (toClose.length === 0) {
    return {
      ok: true,
      closedIds: [],
      skipped,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      closedIds: toClose.map((bead) => bead.id),
      skipped,
    };
  }

  const batchResult = await runMutationBatch(
    { project: { workspacePath: beadsCwd }, reason: `sweep orphaned beads for ${issueId}` },
    async (client) => {
      for (const bead of toClose) {
        await client.mutate(['close', bead.id, '--reason', reason]);
      }
    },
  );

  if (!batchResult.ok) {
    return {
      ok: false,
      closedIds: [],
      skipped: 0,
      error: formatMutationBatchFailure(batchResult),
    };
  }

  return {
    ok: true,
    closedIds: toClose.map((bead) => bead.id),
    skipped,
  };
}
