/**
 * PAN-5279: the merge agent stamps `merged` and `verifying-on-main` after a
 * merge, which maps the tracker state to done. An open epic lands in slices,
 * so a slice merge must not stamp either label on it.
 */
import { describe, expect, it } from 'vitest';

import { postMergeLabelSkipReason } from '../../../../src/lib/cloister/merge-agent.js';

describe('postMergeLabelSkipReason', () => {
  it('skips the post-merge labels for an open epic', async () => {
    const reason = await postMergeLabelSkipReason('PAN-4753', async () => ({ open: true, labels: ['Epic', 'needs-handoff'] }));
    expect(reason).toContain('PAN-4753 is an open epic');
  });

  it('applies them for a non-epic issue and for a closed epic', async () => {
    expect(await postMergeLabelSkipReason('PAN-1', async () => ({ open: true, labels: ['bug'] }))).toBeNull();
    expect(await postMergeLabelSkipReason('PAN-1', async () => ({ open: false, labels: ['epic'] }))).toBeNull();
  });

  it('behaves as before when the tracker does not answer or throws', async () => {
    expect(await postMergeLabelSkipReason('PAN-1', async () => null)).toBeNull();
    expect(await postMergeLabelSkipReason('PAN-1', async () => { throw new Error('tracker down'); })).toBeNull();
  });
});
