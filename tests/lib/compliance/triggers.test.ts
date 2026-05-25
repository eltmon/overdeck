import { describe, expect, it } from 'vitest';

import { matchMemoryFirstTriggerPhrases, matchMemoryFirstTriggers } from '../../../src/lib/compliance/triggers.js';

describe('memory-first trigger matcher', () => {
  it.each([
    ['we recently changed how review handoff works', 'we recently'],
    ['last session we narrowed this to the hook path', 'last session'],
    ['we decided the dashboard owns this prompt', 'we decided'],
    ['can you check the retry fix before merging?', 'the retry fix'],
    ['remember when the workspace got stuck?', 'remember when'],
  ])('matches PRD example phrase %s', (prompt, phrase) => {
    expect(matchMemoryFirstTriggerPhrases(prompt)).toContain(phrase);
  });

  it('returns phrases in prompt order for project-memory prompts', () => {
    expect(matchMemoryFirstTriggerPhrases('Remember when we decided the routing fix should stay small?')).toEqual([
      'Remember when',
      'we decided',
      'the routing fix',
    ]);
  });

  it('returns detailed matches with trigger ids', () => {
    expect(matchMemoryFirstTriggers('Last session covered the auth fix.')).toEqual([
      { triggerId: 'last-session', phrase: 'Last session', index: 0 },
      { triggerId: 'the-fix', phrase: 'the auth fix', index: 21 },
    ]);
  });

  it('returns empty for unrelated prompts', () => {
    expect(matchMemoryFirstTriggerPhrases('Please run typecheck and summarize current failures.')).toEqual([]);
  });
});
