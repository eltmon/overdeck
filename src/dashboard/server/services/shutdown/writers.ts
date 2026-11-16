/**
 * Server-side writers a shutdown drain waits for (PAN-5342, WI-5, D-8).
 *
 * Work the dashboard process does itself that must not be cut off: an
 * auto-merge row in `merging`, a post-merge lifecycle run, and a detached
 * verification worker. The drain only waits for them; force stops waiting and
 * never kills one (boot requeues orphaned `merging` rows and re-adopts
 * verification workers).
 */
import type { ShutdownWriter } from '@overdeck/contracts';

export interface WriterSources {
  readonly mergingAutoMerges: () => Promise<readonly { readonly issueId: string; readonly status: string }[]>;
  readonly postMergeInFlight: () => Promise<readonly string[]>;
  readonly activeVerificationWorkers: () => Promise<
    readonly { readonly issueId: string; readonly startedAt: string; readonly currentGate?: string }[]
  >;
}

const defaultSources: WriterSources = {
  mergingAutoMerges: async () => {
    const { listActiveAutoMerges } = await import('../../../../lib/overdeck/merge-sync.js');
    return listActiveAutoMerges();
  },
  postMergeInFlight: async () => {
    const { postMergeInFlight } = await import('../../../../lib/cloister/post-merge-guard.js');
    return [...postMergeInFlight.keys()];
  },
  activeVerificationWorkers: async () => {
    const { listActiveVerificationWorkers } = await import('../../../../lib/cloister/verification-worker-supervisor.js');
    return listActiveVerificationWorkers();
  },
};

/** Settle one source; a source that throws contributes nothing and is logged. */
async function settle<T>(name: string, read: () => Promise<readonly T[]>): Promise<readonly T[]> {
  try {
    return await read();
  } catch (err) {
    console.warn(`[shutdown] could not list ${name} writers:`, err instanceof Error ? err.message : err);
    return [];
  }
}

export async function listWriters(sources: Partial<WriterSources> = {}): Promise<ShutdownWriter[]> {
  const s = { ...defaultSources, ...sources };
  const [merges, postMerge, workers] = await Promise.all([
    settle('auto-merge', s.mergingAutoMerges),
    settle('post-merge', s.postMergeInFlight),
    settle('verification', s.activeVerificationWorkers),
  ]);
  return [
    ...merges
      .filter((r) => r.status === 'merging')
      .map((r): ShutdownWriter => ({ kind: 'auto-merge', label: `Merging ${r.issueId}` })),
    ...postMerge.map((id): ShutdownWriter => ({ kind: 'post-merge', label: `Post-merge work for ${id}` })),
    ...workers.map((w): ShutdownWriter => ({
      kind: 'verification',
      label: `Verification for ${w.issueId}${w.currentGate ? ` (${w.currentGate})` : ''}`,
      startedAt: w.startedAt,
    })),
  ];
}
