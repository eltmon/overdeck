import { describe, expect, it } from 'vitest';
import { ALL_PROJECTS_KEY, ALL_PROJECTS_LABEL, isRealProjectKey, NO_PROJECT_KEY } from '../projectsData';

describe('isRealProjectKey (PAN-5343 H-D17)', () => {
  it.each([null, undefined, '', '__no-project__', '__all-projects__'])('is false for %j', (key) => {
    expect(isRealProjectKey(key)).toBe(false);
  });

  it('is true for a registered project key', () => {
    expect(isRealProjectKey('overdeck')).toBe(true);
  });

  it('re-exports the All projects key and label', () => {
    expect(ALL_PROJECTS_KEY).toBe('__all-projects__');
    expect(ALL_PROJECTS_LABEL).toBe('All projects');
    expect(NO_PROJECT_KEY).toBe('__no-project__');
  });
});
