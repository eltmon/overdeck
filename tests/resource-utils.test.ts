import { describe, it, expect } from '@effect/vitest';
import { parseContainerServiceName, parseIssueIdFromText } from '../src/lib/resource-utils';

describe('parseIssueIdFromText', () => {
  it('matches hyphenated issue IDs', () => {
    expect(parseIssueIdFromText('myn-feature-min-846-api-1')).toBe('MIN-846');
  });

  it('returns null when no issue ID present', () => {
    expect(parseIssueIdFromText('panopticon-traefik')).toBeNull();
  });
});

describe('parseContainerServiceName', () => {
  it('extracts service name from compose container with issue ID', () => {
    expect(parseContainerServiceName('myn-feature-min-846-api-1')).toBe('api');
  });

  it('extracts service name for postgres', () => {
    expect(parseContainerServiceName('myn-feature-min-846-postgres-1')).toBe('postgres');
  });

  it('returns last segment when no issue ID and no instance number', () => {
    expect(parseContainerServiceName('panopticon-traefik')).toBe('traefik');
  });

  it('returns last non-numeric segment as fallback for devcontainer', () => {
    expect(parseContainerServiceName('devcontainer-frontend-1')).toBe('frontend');
  });
});
