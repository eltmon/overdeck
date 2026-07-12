/**
 * Repair a missing derived beads export from canonical Dolt state.
 *
 * The old implementation restored a tracked JSONL snapshot from git, which
 * could revive stale rows. Dolt is authoritative; repair is now a validated
 * re-export through the one JSONL writer.
 */
import { Effect } from 'effect';

import { exportBeadsJsonl } from './beads/export.js';

export const restoreTrackedBeadsExport = (workspacePath: string): Effect.Effect<void, never> =>
  Effect.tryPromise({ try: () => exportBeadsJsonl(workspacePath).then(() => undefined), catch: () => undefined })
    .pipe(Effect.catch(() => Effect.void));
