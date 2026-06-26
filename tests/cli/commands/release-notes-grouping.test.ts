import { describe, it, expect } from 'vitest';
import { groupCommitSubjects } from '../../../src/cli/commands/release.js';

describe('groupCommitSubjects', () => {
  it('drops pipeline bookkeeping commits entirely', () => {
    const out = groupCommitSubjects([
      'chore(records): update PAN-1793 per-issue record',
      'chore(state): batch update 3 pan/beads file(s)',
      'chore(beads): sync beads state on main',
      'chore(state): update spec for PAN-1827 (status=completed)',
      'docs: run-16 ticks 6-7 state',
      'chore: reconcile local deacon record commits with origin',
      'Merge branch main into feature',
    ]);
    expect(out).toBe('- No user-facing changes in the selected range.');
  });

  it('groups features, fixes, and performance, stripping conventional prefixes', () => {
    const out = groupCommitSubjects([
      'feat(dashboard): backlog pickup controls on issue cockpit',
      'fix(dashboard): show conversation-list cost from the cost_events ledger',
      'Fix Pi handoff prompt readiness',
      'perf(test): move frontend vitest to happy-dom',
    ]);
    expect(out).toContain('### Features\n- Backlog pickup controls on issue cockpit');
    expect(out).toContain('### Fixes');
    expect(out).toContain('- Show conversation-list cost from the cost_events ledger');
    expect(out).toContain('- Fix Pi handoff prompt readiness'); // non-conventional kept as-is
    expect(out).toContain('### Performance\n- Move frontend vitest to happy-dom');
  });

  it('collapses non-highlight commits into a single internal-changes count', () => {
    const out = groupCommitSubjects([
      'fix(dashboard): a real fix',
      'refactor(cli): reshuffle internals',
      'test(paths): cover pi extension cwd resolution',
      'docs: explain the thing',
    ]);
    expect(out).toContain('- A real fix');
    expect(out).toContain('_Plus 3 internal changes (refactors, tests, tooling)._');
  });

  it('uses singular phrasing for exactly one internal change', () => {
    const out = groupCommitSubjects(['refactor(cli): one internal thing']);
    expect(out).toBe('_Plus 1 internal change (refactors, tests, tooling)._');
  });

  it('de-duplicates identical subjects (e.g. cherry-picks)', () => {
    const out = groupCommitSubjects([
      'fix(dashboard): route pi transcripts for strike sessions',
      'fix(dashboard): route pi transcripts for strike sessions',
    ]);
    expect(out.match(/Route pi transcripts/g)).toHaveLength(1);
  });
});
