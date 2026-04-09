import { describe, it, expect } from 'vitest';
import {
  parseIssueId,
  extractPrefix,
  extractNumber,
  normalizeIssueId,
  extractStandardPrefix,
  extractStandardNumber,
} from '../../src/lib/issue-id.js';

describe('parseIssueId', () => {
  describe('standard format (PREFIX-NUMBER)', () => {
    it('parses standard issue ID with uppercase prefix', () => {
      const result = parseIssueId('MIN-123');
      expect(result).toEqual({
        raw: 'MIN-123',
        prefix: 'MIN',
        number: 123,
        normalized: 'min-123',
        format: 'standard',
      });
    });

    it('parses standard issue ID with mixed case prefix', () => {
      const result = parseIssueId('Pan-456');
      expect(result).toEqual({
        raw: 'Pan-456',
        prefix: 'PAN',
        number: 456,
        normalized: 'pan-456',
        format: 'standard',
      });
    });

    it('parses standard issue ID with lowercase prefix', () => {
      const result = parseIssueId('min-789');
      expect(result).toEqual({
        raw: 'min-789',
        prefix: 'MIN',
        number: 789,
        normalized: 'min-789',
        format: 'standard',
      });
    });

    it('parses PAN issue ID', () => {
      const result = parseIssueId('PAN-573');
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
      const result = parseIssueId('F29698');
      expect(result).toEqual({
        raw: 'F29698',
        prefix: 'F',
        number: 29698,
        normalized: 'f29698',
        format: 'rally',
      });
    });

    it('parses Rally User Story ID', () => {
      const result = parseIssueId('US12345');
      expect(result).toEqual({
        raw: 'US12345',
        prefix: 'US',
        number: 12345,
        normalized: 'us12345',
        format: 'rally',
      });
    });

    it('parses Rally Defect ID', () => {
      const result = parseIssueId('DE118304');
      expect(result).toEqual({
        raw: 'DE118304',
        prefix: 'DE',
        number: 118304,
        normalized: 'de118304',
        format: 'rally',
      });
    });

    it('parses Rally Task ID', () => {
      const result = parseIssueId('TA4567');
      expect(result).toEqual({
        raw: 'TA4567',
        prefix: 'TA',
        number: 4567,
        normalized: 'ta4567',
        format: 'rally',
      });
    });

    it('parses Rally Test Case ID', () => {
      const result = parseIssueId('TC999');
      expect(result).toEqual({
        raw: 'TC999',
        prefix: 'TC',
        number: 999,
        normalized: 'tc999',
        format: 'rally',
      });
    });

    it('parses Rally ID with lowercase prefix', () => {
      const result = parseIssueId('f29698');
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
      expect(parseIssueId('notanid')).toBeNull();
    });

    it('returns null for number only', () => {
      expect(parseIssueId('123')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseIssueId('')).toBeNull();
    });

    it('returns null for dash-only', () => {
      expect(parseIssueId('-')).toBeNull();
    });

    it('returns null for prefix with no number', () => {
      expect(parseIssueId('MIN-')).toBeNull();
    });

    it('returns null for number with dash suffix', () => {
      expect(parseIssueId('-123')).toBeNull();
    });
  });
});

describe('extractPrefix', () => {
  it('extracts prefix from standard format', () => {
    expect(extractPrefix('MIN-123')).toBe('MIN');
  });

  it('extracts prefix from Rally format', () => {
    expect(extractPrefix('F29698')).toBe('F');
  });

  it('extracts prefix from Rally User Story format', () => {
    expect(extractPrefix('US12345')).toBe('US');
  });

  it('returns null for invalid format', () => {
    expect(extractPrefix('notanid')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(extractPrefix('min-123')).toBe('MIN');
    expect(extractPrefix('f29698')).toBe('F');
  });
});

describe('extractNumber', () => {
  it('extracts number from standard format', () => {
    expect(extractNumber('MIN-123')).toBe(123);
  });

  it('extracts number from Rally format', () => {
    expect(extractNumber('F29698')).toBe(29698);
  });

  it('extracts number from Rally User Story format', () => {
    expect(extractNumber('US12345')).toBe(12345);
  });

  it('returns null for invalid format', () => {
    expect(extractNumber('notanid')).toBeNull();
  });

  it('handles large numbers', () => {
    expect(extractNumber('DE118304')).toBe(118304);
  });
});

describe('normalizeIssueId', () => {
  it('normalizes standard format with dash', () => {
    expect(normalizeIssueId('MIN-123')).toBe('min-123');
  });

  it('normalizes Rally format without dash', () => {
    expect(normalizeIssueId('F29698')).toBe('f29698');
  });

  it('normalizes Rally User Story format', () => {
    expect(normalizeIssueId('US12345')).toBe('us12345');
  });

  it('returns lowercase for already lowercase standard format', () => {
    expect(normalizeIssueId('min-123')).toBe('min-123');
  });

  it('returns lowercase for unparseable IDs', () => {
    expect(normalizeIssueId('notanid')).toBe('notanid');
  });
});

describe('extractStandardPrefix', () => {
  it('extracts prefix from standard format', () => {
    expect(extractStandardPrefix('MIN-123')).toBe('MIN');
  });

  it('returns null for Rally format', () => {
    expect(extractStandardPrefix('F29698')).toBeNull();
  });

  it('returns null for invalid format', () => {
    expect(extractStandardPrefix('notanid')).toBeNull();
  });
});

describe('extractStandardNumber', () => {
  it('extracts number from standard format', () => {
    expect(extractStandardNumber('MIN-123')).toBe(123);
  });

  it('returns null for Rally format', () => {
    expect(extractStandardNumber('F29698')).toBeNull();
  });

  it('returns null for invalid format', () => {
    expect(extractStandardNumber('notanid')).toBeNull();
  });
});
