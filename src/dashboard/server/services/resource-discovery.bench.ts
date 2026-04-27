import { bench, describe } from 'vitest';

import { discoverResourceAllocatedIssuesFresh } from './resource-discovery.js';

/**
 * PAN-862 acceptance evidence.
 *
 * Target from review / PRD: discovery completes in < 1s for the current workload
 * (28 worktrees, 124 branches). This bench is committed so reviewers can rerun it
 * in the workspace against the live repository state instead of relying on an
 * untracked local measurement.
 *
 * Recommended invocation:
 *   npx vitest bench src/dashboard/server/services/resource-discovery.bench.ts
 */
describe('discoverResourceAllocatedIssuesFresh', () => {
  bench('completes a full uncached discovery pass', async () => {
    await discoverResourceAllocatedIssuesFresh();
  });
});
