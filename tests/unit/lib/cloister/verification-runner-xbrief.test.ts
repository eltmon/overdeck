import { describe, expect, it } from 'vitest';

import { changesetHasNoContent } from '../../../../src/lib/cloister/verification-runner.js';

describe('changesetHasNoContent xBRIEF compatibility', () => {
  it.each([
    '.pan/specs/2026-07-17-PAN-2829-rename.vbrief.json',
    '.pan/specs/2026-07-17-PAN-2829-rename.xbrief.json',
    'specs/2026-07-17-PAN-2829-rename.vbrief.json',
    'specs/2026-07-17-PAN-2829-rename.xbrief.json',
  ])('ignores plan-only changes to %s', (filename) => {
    expect(changesetHasNoContent([filename])).toBe(true);
  });

  it('retains non-plan source changes as content', () => {
    expect(changesetHasNoContent(['src/lib/xbrief/lifecycle.ts'])).toBe(false);
  });
});
