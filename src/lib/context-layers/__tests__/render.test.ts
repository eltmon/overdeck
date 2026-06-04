import { describe, it, expect } from 'vitest';
import {
  applyManagedRegion,
  userContentOutsideRegion,
  hasManagedRegion,
  REGION_BEGIN,
  REGION_END,
} from '../render.js';

describe('applyManagedRegion', () => {
  it('wraps managed content in a single region when none exists', () => {
    const out = applyManagedRegion('', 'hello');
    expect(out).toBe(`${REGION_BEGIN}\nhello\n${REGION_END}\n`);
    expect(hasManagedRegion(out)).toBe(true);
  });

  it('preserves hand-authored content above the region', () => {
    const existing = `# My notes\nstuff\n\n${REGION_BEGIN}\nold\n${REGION_END}\n`;
    const out = applyManagedRegion(existing, 'new');
    expect(out.startsWith('# My notes\nstuff')).toBe(true);
    expect(out).toContain('new');
    expect(out).not.toContain('old');
  });

  // Regression: layer content that mentions the end-marker in prose must not be
  // mistaken for the region terminator. With the old `indexOf` logic this caused
  // CLAUDE.md to accumulate one full copy of the managed region per sync.
  it('treats a literal end-marker inside managed content as content, not terminator', () => {
    // Mirrors real global.md prose: it documents the markers with the short
    // BEGIN form (which never matches the long REGION_BEGIN) and the exact END
    // form (which DOES match REGION_END) — the only real collision.
    const managed = `Edit the source, not the region between the BEGIN and ${REGION_END} markers.`;
    const first = applyManagedRegion('', managed);
    // Exactly one real opening marker survives.
    expect(occurrences(first, REGION_BEGIN)).toBe(1);
    // The prose mention plus the real terminator => two END strings total.
    expect(occurrences(first, REGION_END)).toBe(2);

    // Re-applying must NOT grow the file (idempotent / stable).
    const second = applyManagedRegion(first, managed);
    expect(second).toBe(first);
  });

  it('self-heals a file already bloated with N accumulated copies in one pass', () => {
    const managed = `Rule A\nsee ${REGION_END} note`; // contains an inner end-marker
    // Build a file the buggy renderer would have produced: header + the real
    // BEGIN, then many duplicated bodies, then a single real END terminator.
    const body = `${managed.trim()}`;
    const bloatedMiddle = Array.from({ length: 19 }, () => body).join('\n\n');
    const bloated = `# header\n\n${REGION_BEGIN}\n${bloatedMiddle}\n${REGION_END}\n`;

    const healed = applyManagedRegion(bloated, managed);
    expect(healed.startsWith('# header')).toBe(true);
    expect(occurrences(healed, REGION_BEGIN)).toBe(1);
    expect(occurrences(healed, 'Rule A')).toBe(1); // collapsed from 19 → 1
    // Stable on a second pass.
    expect(applyManagedRegion(healed, managed)).toBe(healed);
  });
});

describe('userContentOutsideRegion', () => {
  it('returns only hand-authored content even when managed prose has an end-marker', () => {
    const managed = `body mentioning ${REGION_END} marker`;
    const file = `# mine\n\n${REGION_BEGIN}\n${managed}\n${REGION_END}\n`;
    expect(userContentOutsideRegion(file)).toBe('# mine');
  });
});

function occurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}
