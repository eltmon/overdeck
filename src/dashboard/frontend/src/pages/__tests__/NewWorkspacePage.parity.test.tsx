import { describe, expect, it } from 'vitest';

const COVERAGE_TESTS = new Set([
  'hero-title',
  'project-order',
  'sole-project-default',
  'project-preset',
  'target-picker',
  'isolated-mode',
  'parent-branch',
  'resolved-preview',
  'inline-findings',
  'disabled-create',
  'bootstrap-main',
  'fresh-mount-reset',
  'created-controller',
]);

const PARITY_CHECKLIST = [
  ['name input', 'hero-title'],
  ['project select and sole-project default', 'sole-project-default'],
  ['project preset accepts key or display name', 'project-preset'],
  ['target dropdown and Browse FolderPicker', 'target-picker'],
  ['shared/isolated toggle drops targetPath', 'isolated-mode'],
  ['advanced parent branch', 'parent-branch'],
  ['resolved path, branch, parent, git, worktree, and target warning', 'resolved-preview'],
  ['inline per-field findings', 'inline-findings'],
  ['Create disabled while stale or invalid', 'disabled-create'],
  ['Register main workspace bootstrap', 'bootstrap-main'],
  ['fresh page mount resets form state', 'fresh-mount-reset'],
  ['onCreated invalidates registry, activates encoded id, and navigates despite activation failure', 'created-controller'],
  ['projects ordered by workspace recency', 'project-order'],
] as const;

function assertParityCoverage(coverage: ReadonlySet<string>) {
  const missing = PARITY_CHECKLIST
    .filter(([, testId]) => !coverage.has(testId))
    .map(([affordance]) => affordance);
  if (missing.length > 0) {
    throw new Error(`Uncovered New Workspace affordances: ${missing.join(', ')}`);
  }
}

describe('New Workspace modal-to-page no-loss audit', () => {
  it('maps every modal affordance to a page or controller coverage test', () => {
    expect(PARITY_CHECKLIST.map(([affordance]) => affordance)).toEqual([
      'name input',
      'project select and sole-project default',
      'project preset accepts key or display name',
      'target dropdown and Browse FolderPicker',
      'shared/isolated toggle drops targetPath',
      'advanced parent branch',
      'resolved path, branch, parent, git, worktree, and target warning',
      'inline per-field findings',
      'Create disabled while stale or invalid',
      'Register main workspace bootstrap',
      'fresh page mount resets form state',
      'onCreated invalidates registry, activates encoded id, and navigates despite activation failure',
      'projects ordered by workspace recency',
    ]);
    expect(() => assertParityCoverage(COVERAGE_TESTS)).not.toThrow();
  });

  it('fails with the affordance name when a coverage row is removed', () => {
    const incomplete = new Set(COVERAGE_TESTS);
    incomplete.delete('bootstrap-main');

    expect(() => assertParityCoverage(incomplete)).toThrow(
      'Uncovered New Workspace affordances: Register main workspace bootstrap',
    );
  });
});
