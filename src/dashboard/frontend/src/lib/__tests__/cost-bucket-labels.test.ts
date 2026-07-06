import { describe, expect, it } from 'vitest';

import { costBucketLabel } from '../cost-bucket-labels';

describe('costBucketLabel', () => {
  it.each([
    ['CONVERSATIONS', 'Conversations'],
    ['FLYWHEEL', 'Flywheel orchestration'],
    ['UNATTRIBUTED', 'No issue — unattributed'],
    ['UNKNOWN', 'No issue — unattributed'],
    ['PAN-2387', 'PAN-2387'],
  ])('maps %s to %s', (issueId, expected) => {
    expect(costBucketLabel(issueId)).toBe(expected);
  });
});
