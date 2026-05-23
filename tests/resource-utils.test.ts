import { describe, it, expect } from 'vitest';
import { parseContainerServiceNameSync, parseIssueIdFromTextSync } from '../src/lib/resource-utils';

describe('parseIssueIdFromText', () => {
  it('matches hyphenated issue IDs', () => {
    expect(parseIssueIdFromTextSync('myn-feature-min-846-api-1')).toBe('MIN-846');
  });

  it('returns null when no issue ID present', () => {
    expect(parseIssueIdFromTextSync('panopticon-traefik')).toBeNull();
  });
});

describe('parseContainerServiceName', () => {
  it('extracts service name from compose container with issue ID', () => {
    expect(parseContainerServiceNameSync('myn-feature-min-846-api-1')).toBe('api');
  });

  it('extracts service name for postgres', () => {
    expect(parseContainerServiceNameSync('myn-feature-min-846-postgres-1')).toBe('postgres');
  });

  it('returns last segment when no issue ID and no instance number', () => {
    expect(parseContainerServiceNameSync('panopticon-traefik')).toBe('traefik');
  });

  it('returns last non-numeric segment as fallback for devcontainer', () => {
    expect(parseContainerServiceNameSync('devcontainer-frontend-1')).toBe('frontend');
  });
});
