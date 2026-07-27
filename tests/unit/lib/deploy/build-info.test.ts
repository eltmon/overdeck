import { afterEach, describe, expect, it } from 'vitest';

import { getBuildInfo } from '../../../../src/lib/deploy/build-info.js';

const buildGlobals = globalThis as typeof globalThis & {
  __OVERDECK_BUILD_COMMIT__?: string;
  __OVERDECK_BUILD_TIME__?: string;
  __OVERDECK_BUILD_DIRTY__?: boolean;
  __OVERDECK_BUILD_BRANCH__?: string | null;
};

function clearBuildGlobals(): void {
  delete buildGlobals.__OVERDECK_BUILD_COMMIT__;
  delete buildGlobals.__OVERDECK_BUILD_TIME__;
  delete buildGlobals.__OVERDECK_BUILD_DIRTY__;
  delete buildGlobals.__OVERDECK_BUILD_BRANCH__;
}

afterEach(clearBuildGlobals);

describe('getBuildInfo', () => {
  it('returns null provenance when compile-time defines are absent', () => {
    clearBuildGlobals();

    expect(getBuildInfo()).toEqual({
      buildCommit: null,
      builtAt: null,
      buildDirty: null,
      buildBranch: null,
    });
  });

  it('returns stamped commit, time, dirty state, and branch values', () => {
    buildGlobals.__OVERDECK_BUILD_COMMIT__ = 'abc123';
    buildGlobals.__OVERDECK_BUILD_TIME__ = '2026-07-26T12:00:00.000Z';
    buildGlobals.__OVERDECK_BUILD_DIRTY__ = true;
    buildGlobals.__OVERDECK_BUILD_BRANCH__ = 'main';

    expect(getBuildInfo()).toEqual({
      buildCommit: 'abc123',
      builtAt: '2026-07-26T12:00:00.000Z',
      buildDirty: true,
      buildBranch: 'main',
    });
  });

  it('reports a detached build branch as null', () => {
    buildGlobals.__OVERDECK_BUILD_COMMIT__ = 'abc123';
    buildGlobals.__OVERDECK_BUILD_TIME__ = '2026-07-26T12:00:00.000Z';
    buildGlobals.__OVERDECK_BUILD_DIRTY__ = false;
    buildGlobals.__OVERDECK_BUILD_BRANCH__ = null;

    expect(getBuildInfo()).toEqual({
      buildCommit: 'abc123',
      builtAt: '2026-07-26T12:00:00.000Z',
      buildDirty: false,
      buildBranch: null,
    });
  });
});
