/**
 * PAN-5637: the CI waiver predicate for polyrepo members that run no CI.
 */
import { describe, expect, it } from 'vitest';

import { checksPass, withMemberCi } from '../member-ci.js';

describe('checksPass', () => {
  it('passes green with or without ciNone', () => {
    expect(checksPass({ checks: 'green' })).toBe(true);
    expect(checksPass({ checks: 'green', ciNone: true })).toBe(true);
    expect(checksPass({ checks: 'green', ciNone: false })).toBe(true);
  });

  it('passes none only when ciNone is true', () => {
    expect(checksPass({ checks: 'none', ciNone: true })).toBe(true);
    expect(checksPass({ checks: 'none' })).toBe(false);
    expect(checksPass({ checks: 'none', ciNone: false })).toBe(false);
  });

  it('never passes red or pending, even with ciNone', () => {
    expect(checksPass({ checks: 'red', ciNone: true })).toBe(false);
    expect(checksPass({ checks: 'pending', ciNone: true })).toBe(false);
    expect(checksPass({ checks: 'red' })).toBe(false);
    expect(checksPass({ checks: 'pending' })).toBe(false);
  });
});

describe('withMemberCi', () => {
  it('stamps ciNone only for a ci: none repo', () => {
    const facts = { checks: 'none' };
    expect(withMemberCi(facts, { ciNone: true })).toEqual({ checks: 'none', ciNone: true });
    expect(withMemberCi(facts, { ciNone: false })).toBe(facts);
    expect(withMemberCi(facts, {})).toBe(facts);
  });
});
