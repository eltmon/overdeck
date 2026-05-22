import { describe, it, expect } from 'vitest';
import {
  parseIssueIdSync,
  extractPrefixSync,
  extractNumberSync,
  normalizeIssueIdSync,
  extractStandardPrefixSync,
  extractStandardNumberSync,
  resolveIssueIdSync,
} from '../../src/lib/issue-id.js';

describe('parseIssueId', () => {
  describe('standard format (PREFIX-NUMBER)', () => {
    it('parses standard issue ID with uppercase prefix', () => {
      const result = parseIssueIdSync('MIN-123');
      expect(result).toEqual({
        raw: 'MIN-123',
        prefix: 'MIN',
        number: 123,
        normalized: 'min-123',
        format: 'standard',
      });
    });

    it('parses standard issue ID with mixed case prefix', () => {
      const result = parseIssueIdSync('Pan-456');
      expect(result).toEqual({
        raw: 'Pan-456',
        prefix: 'PAN',
        number: 456,
        normalized: 'pan-456',
        format: 'standard',
      });
    });

    it('parses standard issue ID with lowercase prefix', () => {
      const result = parseIssueIdSync('min-789');
      expect(result).toEqual({
        raw: 'min-789',
        prefix: 'MIN',
        number: 789,
        normalized: 'min-789',
        format: 'standard',
      });
    });

    it('parses PAN issue ID', () => {
      const result = parseIssueIdSync('PAN-573');
      expect(result).toEqual({
        raw: 'PAN-573',
        prefix: 'PAN',
        number: 573,
        normalized: 'pan-573',
        format: 'standard',
      });
    });
  });

  describe('Rally format (TYPENUMBER)', () => {
    it('parses Rally Feature ID', () => {
      const result = parseIssueIdSync('F29698');
      expect(result).toEqual({
        raw: 'F29698',
        prefix: 'F',
        number: 29698,
        normalized: 'f29698',
        format: 'rally',
      });
    });

    it('parses Rally User Story ID', () => {
      const result = parseIssueIdSync('US12345');
      expect(result).toEqual({
        raw: 'US12345',
        prefix: 'US',
        number: 12345,
        normalized: 'us12345',
        format: 'rally',
      });
    });

    it('parses Rally Defect ID', () => {
      const result = parseIssueIdSync('DE118304');
      expect(result).toEqual({
        raw: 'DE118304',
        prefix: 'DE',
        number: 118304,
        normalized: 'de118304',
        format: 'rally',
      });
    });

    it('parses Rally Task ID', () => {
      const result = parseIssueIdSync('TA4567');
      expect(result).toEqual({
        raw: 'TA4567',
        prefix: 'TA',
        number: 4567,
        normalized: 'ta4567',
        format: 'rally',
      });
    });

    it('parses Rally Test Case ID', () => {
      const result = parseIssueIdSync('TC999');
      expect(result).toEqual({
        raw: 'TC999',
        prefix: 'TC',
        number: 999,
        normalized: 'tc999',
        format: 'rally',
      });
    });

    it('parses Rally ID with lowercase prefix', () => {
      const result = parseIssueIdSync('f29698');
      expect(result).toEqual({
        raw: 'f29698',
        prefix: 'F',
        number: 29698,
        normalized: 'f29698',
        format: 'rally',
      });
    });
  });

  describe('invalid inputs', () => {
    it('returns null for plain text', () => {
      expect(parseIssueIdSync('notanid')).toBeNull();
    });

    it('returns null for number only', () => {
      expect(parseIssueIdSync('123')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseIssueIdSync('')).toBeNull();
    });

    it('returns null for dash-only', () => {
      expect(parseIssueIdSync('-')).toBeNull();
    });

    it('returns null for prefix with no number', () => {
      expect(parseIssueIdSync('MIN-')).toBeNull();
    });

    it('returns null for number with dash suffix', () => {
      expect(parseIssueIdSync('-123')).toBeNull();
    });
  });
});

describe('extractPrefix', () => {
  it('extracts prefix from standard format', () => {
    expect(extractPrefixSync('MIN-123')).toBe('MIN');
  });

  it('extracts prefix from Rally format', () => {
    expect(extractPrefixSync('F29698')).toBe('F');
  });

  it('extracts prefix from Rally User Story format', () => {
    expect(extractPrefixSync('US12345')).toBe('US');
  });

  it('returns null for invalid format', () => {
    expect(extractPrefixSync('notanid')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(extractPrefixSync('min-123')).toBe('MIN');
    expect(extractPrefixSync('f29698')).toBe('F');
  });
});

describe('extractNumber', () => {
  it('extracts number from standard format', () => {
    expect(extractNumberSync('MIN-123')).toBe(123);
  });

  it('extracts number from Rally format', () => {
    expect(extractNumberSync('F29698')).toBe(29698);
  });

  it('extracts number from Rally User Story format', () => {
    expect(extractNumberSync('US12345')).toBe(12345);
  });

  it('returns null for invalid format', () => {
    expect(extractNumberSync('notanid')).toBeNull();
  });

  it('handles large numbers', () => {
    expect(extractNumberSync('DE118304')).toBe(118304);
  });
});

describe('normalizeIssueId', () => {
  it('normalizes standard format with dash', () => {
    expect(normalizeIssueIdSync('MIN-123')).toBe('min-123');
  });

  it('normalizes Rally format without dash', () => {
    expect(normalizeIssueIdSync('F29698')).toBe('f29698');
  });

  it('normalizes Rally User Story format', () => {
    expect(normalizeIssueIdSync('US12345')).toBe('us12345');
  });

  it('returns lowercase for already lowercase standard format', () => {
    expect(normalizeIssueIdSync('min-123')).toBe('min-123');
  });

  it('returns lowercase for unparseable IDs', () => {
    expect(normalizeIssueIdSync('notanid')).toBe('notanid');
  });
});

describe('extractStandardPrefix', () => {
  it('extracts prefix from standard format', () => {
    expect(extractStandardPrefixSync('MIN-123')).toBe('MIN');
  });

  it('returns null for Rally format', () => {
    expect(extractStandardPrefixSync('F29698')).toBeNull();
  });

  it('returns null for invalid format', () => {
    expect(extractStandardPrefixSync('notanid')).toBeNull();
  });
});

describe('extractStandardNumber', () => {
  it('extracts number from standard format', () => {
    expect(extractStandardNumberSync('MIN-123')).toBe(123);
  });

  it('returns null for Rally format', () => {
    expect(extractStandardNumberSync('F29698')).toBeNull();
  });

  it('returns null for invalid format', () => {
    expect(extractStandardNumberSync('notanid')).toBeNull();
  });
});

describe('resolveIssueId', () => {
  it('uppercases a bare issue id', () => {
    expect(resolveIssueIdSync('pan-123')).toBe('PAN-123');
  });

  it('leaves an already-uppercase id unchanged', () => {
    expect(resolveIssueIdSync('PAN-123')).toBe('PAN-123');
  });

  it('strips the "agent-" prefix and uppercases', () => {
    expect(resolveIssueIdSync('agent-pan-123')).toBe('PAN-123');
  });

  it('strips the "agent-" prefix case-insensitively', () => {
    expect(resolveIssueIdSync('Agent-Pan-456')).toBe('PAN-456');
    expect(resolveIssueIdSync('AGENT-pan-789')).toBe('PAN-789');
  });

  it('does not strip non-leading "agent-" occurrences', () => {
    // "agent-" that isn't at the start stays put (then gets uppercased)
    expect(resolveIssueIdSync('pan-agent-123')).toBe('PAN-AGENT-123');
  });

  it('returns empty string for empty input', () => {
    expect(resolveIssueIdSync('')).toBe('');
  });

  it('uppercases a prefix-less identifier', () => {
    // Rally-style IDs have no dash — still uppercased, not rejected
    expect(resolveIssueIdSync('f29698')).toBe('F29698');
  });

  it('strips only one leading agent- token, not repeated prefixes', () => {
    // The regex matches a single /^agent-/ (anchored, non-greedy by default).
    // A double-prefix leaves the inner "agent-" intact, then uppercases.
    expect(resolveIssueIdSync('agent-agent-pan-1')).toBe('AGENT-PAN-1');
  });
});
