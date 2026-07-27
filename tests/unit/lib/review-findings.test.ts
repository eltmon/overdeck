import { describe, it, expect } from 'vitest';
import {
  extractMarkdownSection,
  findBlockingFindings,
  countSynthesisBlockingFindings,
} from '../../../src/lib/review-findings.js';

describe('review-findings', () => {
  describe('extractMarkdownSection', () => {
    it('extracts a markdown section by heading', () => {
      const markdown = `
# Title
## Findings
This is the findings section.
## Other
This is other.
`;
      const result = extractMarkdownSection(markdown, 'Findings');
      expect(result).toContain('This is the findings section.');
      expect(result).not.toContain('This is other.');
    });

    it('returns empty string when section not found', () => {
      const markdown = `
# Title
## Other
Content
`;
      const result = extractMarkdownSection(markdown, 'Findings');
      expect(result).toBe('');
    });
  });

  describe('findBlockingFindings', () => {
    it('returns blocking finding titles from report format', () => {
      const markdown = `
# Report
## Findings
### ! First blocking issue
Some details
### ⊗ Second blocking issue
More details
### Non-blocking note
This is not blocking (no ! or ⊗)
`;
      const result = findBlockingFindings(markdown);
      expect(result).toEqual(['First blocking issue', 'Second blocking issue']);
    });

    it('returns empty array when findings section says None', () => {
      const markdown = `
## Findings
None.
`;
      const result = findBlockingFindings(markdown);
      expect(result).toEqual([]);
    });

    it('returns empty array when findings section is missing', () => {
      const markdown = `
# Report
## Other section
Content
`;
      const result = findBlockingFindings(markdown);
      expect(result).toEqual([]);
    });

    it('handles various whitespace in blocking markers', () => {
      const markdown = `
## Findings
###! First
### ! Second
###  !  Third
`;
      const result = findBlockingFindings(markdown);
      expect(result).toContain('First');
      expect(result).toContain('Second');
      expect(result).toContain('Third');
    });
  });

  describe('countSynthesisBlockingFindings', () => {
    it('counts blocking findings from synthesis format', () => {
      const synthesis = `
# Synthesis
## Blocking Findings
### [correctness] Issue 1
### [security] Issue 2
### [performance] Issue 3
### [requirements] Issue 4
`;
      const result = countSynthesisBlockingFindings(synthesis);
      expect(result).toBe(4);
    });

    it('returns 12 for fixture with 12 headings', () => {
      const headings = Array.from({ length: 12 }, (_, i) => `### [role${i}] Issue ${i + 1}`).join('\n');
      const synthesis = `
# Synthesis
## Blocking Findings
${headings}
`;
      const result = countSynthesisBlockingFindings(synthesis);
      expect(result).toBe(12);
    });

    it('returns 0 when Blocking Findings section says None', () => {
      const synthesis = `
# Synthesis
## Blocking Findings
None
`;
      const result = countSynthesisBlockingFindings(synthesis);
      expect(result).toBe(0);
    });

    it('returns 0 when Blocking Findings section is missing', () => {
      const synthesis = `
# Synthesis
## Other Section
Content
`;
      const result = countSynthesisBlockingFindings(synthesis);
      expect(result).toBe(0);
    });

    it('returns 0 when Blocking Findings section is empty', () => {
      const synthesis = `
# Synthesis
## Blocking Findings

## Other Section
`;
      const result = countSynthesisBlockingFindings(synthesis);
      expect(result).toBe(0);
    });

    it('handles case-insensitive None matching', () => {
      const synthesis = `
## Blocking Findings
none.
`;
      const result = countSynthesisBlockingFindings(synthesis);
      expect(result).toBe(0);
    });
  });
});
