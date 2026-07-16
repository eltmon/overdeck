import { describe, expect, it } from 'vitest';
import { parseQuarantineList, readQuarantineList } from '../../../../src/lib/test-infra/quarantine.js';

describe('parseQuarantineList', () => {
  it('returns paths and drops comments, blanks, and trailing whitespace', () => {
    const input = `
# header comment
tests/foo.test.ts  # PAN-123

src/bar.test.ts  # #456
# footer
`;
    expect(parseQuarantineList(input)).toEqual([
      'tests/foo.test.ts',
      'src/bar.test.ts',
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseQuarantineList('')).toEqual([]);
    expect(parseQuarantineList('\n\n# only comments\n')).toEqual([]);
  });
});

describe('readQuarantineList', () => {
  it('reads the project quarantine file', () => {
    const list = readQuarantineList(process.cwd());
    // The seed file contains at least the two known flakes.
    expect(list).toContain('tests/playwright/conversation-supervisor-uat.test.ts');
  });

  it('returns an empty array when the quarantine file is absent', () => {
    const list = readQuarantineList('/tmp/nonexistent-project-root-12345');
    expect(list).toEqual([]);
  });
});
