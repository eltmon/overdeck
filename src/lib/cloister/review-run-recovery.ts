import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { Effect } from 'effect';

import { saveAgentState, type AgentState } from '../agents/agent-state.js';
import { PAN_DIRNAME } from '../pan-dir/types.js';

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function findRecoverableRunId(parent: AgentState): Promise<string | null> {
  const startedAt = Date.parse(parent.startedAt);
  if (!Number.isFinite(startedAt)) return null;

  const reviewRoot = join(parent.workspace, PAN_DIRNAME, 'review');
  let entries;
  try {
    entries = await readdir(reviewRoot, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }

  const matchingRunIds = (
    await Promise.all(entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith(`${parent.id}-`))
      .map(async (entry) => {
        try {
          const runStat = await stat(join(reviewRoot, entry.name));
          return runStat.mtimeMs >= startedAt ? entry.name : null;
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      }))
  ).filter((runId): runId is string => runId !== null);

  return matchingRunIds.length === 1 ? matchingRunIds[0] : null;
}

/**
 * Restore a review parent's active run metadata from its durable workspace
 * artifact when the runtime registry lost the cached fields. Recovery is
 * deliberately fail-closed unless exactly one current run directory matches.
 */
export async function resolveReviewParentRunState(
  parent: AgentState,
  options: { persistCurrent?: boolean } = {},
): Promise<AgentState | null> {
  if (!parent.workspace) return null;

  const runId = parent.reviewRunId ?? await findRecoverableRunId(parent);
  if (!runId) return null;

  const contextManifestPath = parent.reviewContextManifestPath
    ?? join(parent.workspace, PAN_DIRNAME, 'review', runId, 'context.json');
  const resolved = {
    ...parent,
    reviewRunId: runId,
    ...(await pathExists(contextManifestPath) ? { reviewContextManifestPath: contextManifestPath } : {}),
  };
  const changed = resolved.reviewRunId !== parent.reviewRunId
    || resolved.reviewContextManifestPath !== parent.reviewContextManifestPath;

  if (changed || options.persistCurrent) {
    await Effect.runPromise(saveAgentState(resolved));
  }

  return resolved;
}
