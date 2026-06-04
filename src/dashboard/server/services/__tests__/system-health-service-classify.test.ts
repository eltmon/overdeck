import { describe, expect, it } from 'vitest';

import { classifyAgentKind } from '../system-health-service.js';

describe('classifyAgentKind (PAN-1257)', () => {
  it.each([
    ['work', 'work'],
    ['review', 'specialist'],
    ['review-correctness', 'specialist'],
    ['review-security', 'specialist'],
    ['test', 'specialist'],
    ['ship', 'specialist'],
    [undefined, 'work'],
    [null, 'specialist'],
  ] as const)('classifies agent-* with role %s as %s', (role, expected) => {
    expect(classifyAgentKind('agent-foo', role as unknown as string | undefined)).toBe(expected);
  });

  it('classifies legacy planning prefixes as planning agents', () => {
    expect(classifyAgentKind('planning-foo')).toBe('planning');
  });

  it('classifies legacy specialist prefixes as specialists', () => {
    expect(classifyAgentKind('specialist-foo')).toBe('specialist');
  });
});
