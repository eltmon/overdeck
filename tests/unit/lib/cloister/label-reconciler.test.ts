import { describe, expect, it, vi } from 'vitest';
import { reconcilePipelineLabels } from '../../../../src/lib/cloister/label-reconciler.js';

describe('PAN-2543 pipeline label reconciler', () => {
  const matrix = [
    { issueId: 'PAN-1', issueClosed: false, labels: ['verifying-on-main', 'merged'], recordTerminal: true, mergedWithoutInflight: false, closeOutComplete: true },
    { issueId: 'PAN-2', issueClosed: false, labels: ['planning'], recordTerminal: false, mergedWithoutInflight: false, closeOutComplete: false },
    { issueId: 'PAN-3', issueClosed: true, labels: ['in-review'], recordTerminal: false, mergedWithoutInflight: false, closeOutComplete: false },
  ];

  it('removes only stale terminal labels and marks incomplete close-out', async () => {
    await expect(reconcilePipelineLabels(matrix, { dryRun: true })).resolves.toEqual([
      { issueId: 'PAN-1', op: 'remove', label: 'verifying-on-main' },
      { issueId: 'PAN-3', op: 'remove', label: 'in-review' },
    ]);
  });

  it('dry-run mutates nothing and patrol batches by issue', async () => {
    const edit = vi.fn(async () => undefined);
    await reconcilePipelineLabels(matrix, { dryRun: true, maxIssues: 2 }, edit);
    expect(edit).not.toHaveBeenCalled();
    await reconcilePipelineLabels(matrix, { maxIssues: 1 }, edit);
    expect(edit).toHaveBeenCalledTimes(1);
  });
});
