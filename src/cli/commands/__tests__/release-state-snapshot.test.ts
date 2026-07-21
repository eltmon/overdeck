import { describe, expect, it } from 'vitest';
import { buildReleaseNotesMarkdown } from '../release.js';

describe('release state snapshot', () => {
  it('records the exact overdeck-state SHA when provided', () => {
    const sha = 'a'.repeat(40);
    const notes = buildReleaseNotesMarkdown({
      channel: 'stable',
      version: '1.2.3',
      from: 'v1.2.2',
      to: 'v1.2.3',
      entries: [],
      packageName: '@overdeck/core',
      stateBranchSha: sha,
    });
    expect(notes).toContain(`State snapshot: overdeck-state ${sha}`);
  });
});
