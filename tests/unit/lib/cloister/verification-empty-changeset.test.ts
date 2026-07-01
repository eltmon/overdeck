import { describe, it, expect } from 'vitest';
import { changesetHasNoContent } from '../../../../src/lib/cloister/verification-runner.js';

// PAN-2179: the verification gate must reject a "plan-only" / zombie changeset
// (a work agent that never kicked off leaves only pipeline artifacts), but must
// NOT reject a legitimate non-code change (docs/rules/config).
describe('changesetHasNoContent (PAN-2179 empty-changeset guard)', () => {
  it('flags a plan-only changeset (only .pan/vbrief/beads)', () => {
    expect(
      changesetHasNoContent([
        '.pan/specs/2026-06-29-PAN-X-thing.vbrief.json',
        '.pan/records/pan-x.json',
        '.beads/issues.jsonl',
      ]),
    ).toBe(true);
  });

  it('flags an empty / whitespace-only diff', () => {
    expect(changesetHasNoContent([])).toBe(true);
    expect(changesetHasNoContent(['', '  '])).toBe(true);
  });

  it('does NOT flag a changeset with real src/ code', () => {
    expect(
      changesetHasNoContent(['.pan/specs/x.vbrief.json', 'src/lib/cloister/foo.ts']),
    ).toBe(false);
  });

  it('does NOT flag a legit docs/rules chore (PAN-1884-style: no src/, but real content)', () => {
    expect(
      changesetHasNoContent([
        '.pan/records/pan-1884.json',
        'sync-sources/rules/investigate-before-fixing.md',
      ]),
    ).toBe(false);
  });
});
