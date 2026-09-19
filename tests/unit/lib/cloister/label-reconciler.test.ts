import { describe, expect, it, vi } from 'vitest';
import { reconcilePipelineLabels } from '../../../../src/lib/cloister/label-reconciler.js';

describe('PAN-2543 pipeline label reconciler (PAN-3917: tracker-derived terminality)', () => {
  const matrix = [
    // merged + no in-flight phase label → terminal, and still open so it needs close-out
    { issueId: 'PAN-1', issueClosed: false, labels: ['verifying-on-main', 'merged'], mergedWithoutInflight: true },
    // open, mid-pipeline → untouched
    { issueId: 'PAN-2', issueClosed: false, labels: ['planning'], mergedWithoutInflight: false },
    // closed → stale phase label removed, no needs-close-out on a closed issue
    { issueId: 'PAN-3', issueClosed: true, labels: ['in-review'], mergedWithoutInflight: false },
  ];

  it('removes only stale terminal labels and marks incomplete close-out', async () => {
    await expect(reconcilePipelineLabels(matrix, { dryRun: true })).resolves.toEqual([
      { issueId: 'PAN-1', op: 'remove', label: 'verifying-on-main' },
      { issueId: 'PAN-1', op: 'add', label: 'needs-close-out' },
      { issueId: 'PAN-3', op: 'remove', label: 'in-review' },
    ]);
  });

  it('leaves an open in-flight issue alone', async () => {
    await expect(reconcilePipelineLabels([matrix[1]], { dryRun: true })).resolves.toEqual([]);
  });

  it('dry-run mutates nothing and patrol batches by issue', async () => {
    const edit = vi.fn(async () => undefined);
    await reconcilePipelineLabels(matrix, { dryRun: true, maxIssues: 2 }, edit);
    expect(edit).not.toHaveBeenCalled();
    await reconcilePipelineLabels(matrix, { maxIssues: 1 }, edit);
    expect(edit).toHaveBeenCalledTimes(2);
  });
});
