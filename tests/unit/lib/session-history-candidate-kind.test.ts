import { describe, expect, it } from 'vitest';

import { transcriptCandidateKind } from '../../../src/lib/session-history.js';

describe('transcriptCandidateKind (PAN-4562)', () => {
  it.each([
    ['claude-code', 'claude'],
    ['ohmypi', 'ohmypi'],
    ['codex', 'codex'],
    ['acp', 'acp'],
    ['kimi-code', 'kimi'],
    ['opencode', 'acp'],
    ['muse', 'muse'],
    ['prime-agent', 'prime-agent'],
  ] as const)('%s maps to the %s candidate kind', (harness, kind) => {
    expect(transcriptCandidateKind(harness)).toBe(kind);
  });

  it('keeps the legacy pi alias as its own candidate kind', () => {
    expect(transcriptCandidateKind('pi')).toBe('pi');
  });

  it.each([null, undefined, 'unknown'])('falls back to claude for %s', (harness) => {
    expect(transcriptCandidateKind(harness)).toBe('claude');
  });
});
