import {
  claimPendingLifecycleFile,
  settlePendingLifecycleClaim,
} from './pending-lifecycle-claim.js';

interface PendingLifecycleData {
  issueId: string;
  projectPath: string;
  sourceBranch?: string;
  timestamp?: number;
}

export async function processPendingLifecycleForPatrol(
  pendingFile: string,
): Promise<string | null> {
  const claim = await claimPendingLifecycleFile(pendingFile);
  if (!claim) return null;

  let pending: PendingLifecycleData;
  try {
    pending = JSON.parse(claim.raw) as PendingLifecycleData;
  } catch (error) {
    await claim.discard();
    throw error;
  }

  const age = Date.now() - (pending.timestamp ?? 0);
  if (age >= 60 * 60 * 1000) {
    await claim.discard();
    console.log(`[deacon] Discarded stale pending post-merge claim (age: ${Math.round(age / 60000)}m)`);
    return null;
  }

  console.log(`[deacon] Processing pending post-merge lifecycle for ${pending.issueId} (age: ${Math.round(age / 1000)}s)`);
  try {
    const { postMergeLifecycle } = await import('./merge-agent.js');
    await postMergeLifecycle(pending.issueId, pending.projectPath, pending.sourceBranch, { skipDeploy: true });
    await settlePendingLifecycleClaim(claim, pending.issueId, true);
    return `Processed pending post-merge lifecycle for ${pending.issueId}`;
  } catch (error) {
    await settlePendingLifecycleClaim(claim, pending.issueId, false);
    throw error;
  }
}
