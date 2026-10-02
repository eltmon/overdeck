/**
 * PAN-4451: parsing and validating the refs `pan task block --on` names.
 */
import { describe, expect, it } from 'vitest';

import {
  BlockerRefError,
  formatBlockerRef,
  parseBlockerRefs,
  parseStoredBlockerRef,
  type BlockerRef,
  type BlockerRefContext,
} from '../blocker-refs.js';

function ctx(overrides: Partial<BlockerRefContext> = {}): BlockerRefContext {
  return {
    blockedIssueId: 'PAN-4437',
    isKnownIssue: (id) => id.startsWith('PAN-'),
    blockedIssueRepo: () => 'eltmon/overdeck',
    ...overrides,
  };
}

const PR_4444: BlockerRef = { kind: 'pr', repo: 'eltmon/overdeck', number: 4444 };

describe('parseBlockerRefs', () => {
  it('accepts an issue ID and uppercases it', () => {
    expect(parseBlockerRefs(['pan-4307'], ctx())).toEqual([{ kind: 'issue', id: 'PAN-4307' }]);
  });

  it('resolves #N against the blocked issue repo', () => {
    expect(parseBlockerRefs(['#4444'], ctx())).toEqual([PR_4444]);
  });

  it('accepts owner/repo#N', () => {
    expect(parseBlockerRefs(['eltmon/overdeck#4444'], ctx())).toEqual([PR_4444]);
  });

  it('accepts a GitHub PR URL', () => {
    expect(parseBlockerRefs(['https://github.com/eltmon/overdeck/pull/4444'], ctx())).toEqual([PR_4444]);
    expect(parseBlockerRefs(['https://github.com/eltmon/overdeck/pull/4444/files'], ctx())).toEqual([PR_4444]);
  });

  it('splits comma-separated values and skips empty pieces', () => {
    expect(parseBlockerRefs(['PAN-4307, #4444,', 'PAN-4436'], ctx())).toEqual([
      { kind: 'issue', id: 'PAN-4307' },
      PR_4444,
      { kind: 'issue', id: 'PAN-4436' },
    ]);
  });

  it('de-duplicates refs in input order', () => {
    expect(parseBlockerRefs([
      'PAN-4307,#4444',
      'pan-4307',
      'https://github.com/eltmon/overdeck/pull/4444',
      'eltmon/overdeck#4444',
    ], ctx())).toEqual([{ kind: 'issue', id: 'PAN-4307' }, PR_4444]);
  });

  it('rejects an issue of an unregistered project', () => {
    expect(() => parseBlockerRefs(['ZZZ-1'], ctx())).toThrow(BlockerRefError);
    expect(() => parseBlockerRefs(['ZZZ-1'], ctx())).toThrow('ZZZ-1 is not an issue of a registered project');
  });

  it('rejects the blocked issue itself', () => {
    expect(() => parseBlockerRefs(['pan-4437'], ctx())).toThrow('PAN-4437 cannot be blocked on itself');
  });

  it('rejects #N when the blocked issue is not on GitHub', () => {
    expect(() => parseBlockerRefs(['#7'], ctx({ blockedIssueRepo: () => null })))
      .toThrow('#7 needs the blocked issue to be on GitHub; use a full PR URL');
  });

  it('rejects a GitLab merge request URL', () => {
    expect(() => parseBlockerRefs(['https://gitlab.com/group/proj/-/merge_requests/12'], ctx()))
      .toThrow('GitLab merge requests are not supported; name the issue ID instead');
  });

  it('rejects an unparsable value', () => {
    expect(() => parseBlockerRefs(['PAN-4307', 'nonsense'], ctx()))
      .toThrow('nonsense is not an issue ID, #N, owner/repo#N, or a GitHub PR URL');
  });

  it('rejects zero refs', () => {
    expect(() => parseBlockerRefs([' , '], ctx())).toThrow('--on needs at least one issue or PR');
  });
});

describe('formatBlockerRef / parseStoredBlockerRef', () => {
  it('formats canonical strings', () => {
    expect(formatBlockerRef({ kind: 'issue', id: 'PAN-4307' })).toBe('PAN-4307');
    expect(formatBlockerRef(PR_4444)).toBe('eltmon/overdeck#4444');
  });

  it.each([{ kind: 'issue', id: 'PAN-4307' }, PR_4444] as BlockerRef[])('round-trips %o', (ref) => {
    expect(parseStoredBlockerRef(formatBlockerRef(ref))).toEqual(ref);
  });

  it('returns null for an unparsable string', () => {
    expect(parseStoredBlockerRef('not a ref')).toBeNull();
    expect(parseStoredBlockerRef('#4444')).toBeNull();
  });
});
