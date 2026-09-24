import { describe, it, expect } from 'vitest';
import { parseIssueIdFromText  } from '../src/lib/resource-utils';

describe('parseIssueIdFromText', () => {
  it('matches hyphenated issue IDs', () => {
    expect(parseIssueIdFromText('myn-feature-min-846-api-1')).toBe('MIN-846');
  });

  it('returns null when no issue ID present', () => {
    expect(parseIssueIdFromText('overdeck-traefik')).toBeNull();
  });
});

