import { describe, expect, it } from 'vitest';

import { mergedIssueIdsForGithubProject } from '../merged-issue-ids.js';

describe('mergedIssueIdsForGithubProject (PAN-4753 WI-3)', () => {
  it('returns upper-case ids of merged feature PRs only', async () => {
    const ids = await mergedIssueIdsForGithubProject('/repo', {
      listRows: async () => [
        { headRefName: 'feature/pan-1', mergedAt: '2026-11-14T10:00:00Z' },
        { headRefName: 'feature/pan-2', mergedAt: null },
        { headRefName: 'strike/pan-3', mergedAt: '2026-11-14T10:00:00Z' },
        { headRefName: 'main', mergedAt: '2026-11-14T10:00:00Z' },
      ],
    });
    expect([...ids]).toEqual(['PAN-1']);
  });
});
