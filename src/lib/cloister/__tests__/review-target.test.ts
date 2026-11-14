import { describe, expect, it } from 'vitest';

import { resolveReviewTarget } from '../review-target.js';

const PROJECT = '/repos/overdeck';

function target(existing: string[], projectPath: string | null = PROJECT) {
  const present = new Set(existing);
  return resolveReviewTarget('PAN-7', { projectPath: () => projectPath, exists: (path) => present.has(path) });
}

describe('resolveReviewTarget (PAN-4753 WI-5)', () => {
  it('prefers the feature workspace when it exists', () => {
    expect(target([`${PROJECT}/workspaces/feature-pan-7`, `${PROJECT}/workspaces/feature-pan-7-strike`])).toEqual({
      kind: 'feature',
      workspacePath: `${PROJECT}/workspaces/feature-pan-7`,
      branch: 'feature/pan-7',
    });
  });

  it('answers the strike workspace and branch when only the strike workspace exists', () => {
    expect(target([`${PROJECT}/workspaces/feature-pan-7-strike`])).toEqual({
      kind: 'strike',
      workspacePath: `${PROJECT}/workspaces/feature-pan-7-strike`,
      branch: 'strike/pan-7',
    });
  });

  it('answers null when neither workspace exists or no project owns the issue', () => {
    expect(target([])).toBeNull();
    expect(target([`${PROJECT}/workspaces/feature-pan-7`], null)).toBeNull();
  });
});
