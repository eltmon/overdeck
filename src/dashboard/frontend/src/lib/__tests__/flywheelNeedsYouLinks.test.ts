import { describe, expect, it } from 'vitest';

import { needsYouSegments } from '../flywheelNeedsYouLinks';
import type { FlywheelInFlightRow } from '@overdeck/contracts';

function inFlightRow(overrides: Partial<FlywheelInFlightRow> = {}): FlywheelInFlightRow {
  return {
    issueId: 'PAN-1',
    title: 'Some issue',
    state: 'working',
    liveAgents: 1,
    inTick: true,
    lastJournal: null,
    ...overrides,
  };
}

describe('needsYouSegments (PAN-5198)', () => {
  it('splits an issue ID out of surrounding text', () => {
    expect(needsYouSegments('waive PAN-5095 test removal', [])).toEqual([
      { kind: 'text', text: 'waive ' },
      { kind: 'issue', text: 'PAN-5095', issueId: 'PAN-5095' },
      { kind: 'text', text: ' test removal' },
    ]);
  });

  it('links "PR #n" to an in-flight row with that PR number', () => {
    const inFlight = [inFlightRow({ pr: { url: 'https://github.com/eltmon/overdeck/pull/5127', number: 5127, reviewState: 'review-requested', checks: 'pending', mergeable: null } })];
    expect(needsYouSegments('PR #5127 merge', inFlight)).toEqual([
      { kind: 'pr', text: 'PR #5127', url: 'https://github.com/eltmon/overdeck/pull/5127' },
      { kind: 'text', text: ' merge' },
    ]);
  });

  it('renders a bare PR reference as text when no in-flight row matches', () => {
    expect(needsYouSegments('PR #7 merge', [])).toEqual([{ kind: 'text', text: 'PR #7 merge' }]);
  });

  it('links a qualified owner/repo#n reference to GitHub without needing an in-flight row', () => {
    expect(needsYouSegments('eltmon/overdeck-landing#7 merge', [])).toEqual([
      { kind: 'pr', text: 'eltmon/overdeck-landing#7', url: 'https://github.com/eltmon/overdeck-landing/pull/7' },
      { kind: 'text', text: ' merge' },
    ]);
  });

  it('returns one text segment for input with no reference', () => {
    expect(needsYouSegments('upload AAB', [])).toEqual([{ kind: 'text', text: 'upload AAB' }]);
    expect(needsYouSegments('UTF8 and abc-12', [])).toEqual([{ kind: 'text', text: 'UTF8 and abc-12' }]);
  });
});
