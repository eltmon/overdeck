/** PAN-4651 WI-16 (D-4651-13): a linked conversation attaches to the local project with its git origin. */
import { describe, expect, it } from 'vitest';

import { resolveEffectiveProjectKey } from '../projectsData';

const PROJECTS = [{ key: 'overdeck', name: 'Overdeck', path: '/home/me/Projects/overdeck' }];
const LINKED = { origin: 'linked', projectKey: 'od', gitOrigin: 'github.com/Eltmon/Overdeck', cwd: '/Users/desk/Projects/od' };
const index = (combine: boolean) => ({ combine, localKeyByOrigin: new Map([['github.com/eltmon/overdeck', 'overdeck']]) });

describe('resolveEffectiveProjectKey by git origin (PAN-4651 WI-16)', () => {
  it('ac16: resolves to the local overdeck project when combine is on, and to its own key when off', () => {
    expect(resolveEffectiveProjectKey(LINKED, PROJECTS, index(true))).toBe('overdeck');
    expect(resolveEffectiveProjectKey(LINKED, PROJECTS, index(false))).toBe('od');
  });

  it('leaves local conversations and unknown origins to the existing rules', () => {
    expect(resolveEffectiveProjectKey({ cwd: '/home/me/Projects/overdeck/src' }, PROJECTS, index(true))).toBe('overdeck');
    expect(resolveEffectiveProjectKey({ ...LINKED, gitOrigin: 'github.com/x/y' }, PROJECTS, index(true))).toBe('od');
    expect(resolveEffectiveProjectKey({ origin: 'local', projectKey: 'p', gitOrigin: 'github.com/eltmon/overdeck' }, PROJECTS, index(true))).toBe('p');
  });
});
