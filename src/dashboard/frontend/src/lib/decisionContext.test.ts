import { describe, expect, it } from 'vitest';

import { liftOptionConsequences } from './decisionContext';

describe('liftOptionConsequences', () => {
  it('lifts "- **Label:** text" bullets for matching options', () => {
    const result = liftOptionConsequences(
      '- A fact.\n- **Close now:** runs the check later.\n- **Hold:** the issue stays open.',
      ['Close now', 'Hold'],
    );

    expect(result.consequences).toEqual({ 'Close now': 'runs the check later.', Hold: 'the issue stays open.' });
    expect(result.remainingContext).toBe('- A fact.');
  });

  it('lifts "* **Label**: text" bullets and matches labels case-insensitively', () => {
    const result = liftOptionConsequences('* **close NOW**: runs the check later.', ['Close now']);

    expect(result.consequences).toEqual({ 'Close now': 'runs the check later.' });
    expect(result.remainingContext).toBeUndefined();
  });

  it('leaves non-matching bullets in the remaining context', () => {
    const result = liftOptionConsequences('- plain bullet\n- **Bold lead** without a colon\n- **Hold:** waits.', ['Hold']);

    expect(result.consequences).toEqual({ Hold: 'waits.' });
    expect(result.remainingContext).toBe('- plain bullet\n- **Bold lead** without a colon');
  });

  it('returns undefined remaining context when only blank lines remain', () => {
    const result = liftOptionConsequences('\n- **Yes:** go.\n\n- **No:** stop.\n', ['Yes', 'No']);

    expect(result.consequences).toEqual({ Yes: 'go.', No: 'stop.' });
    expect(result.remainingContext).toBeUndefined();
  });

  it('ignores labels that match no option', () => {
    const result = liftOptionConsequences('- **Maybe:** not an option.', ['Yes', 'No']);

    expect(result.consequences).toEqual({});
    expect(result.remainingContext).toBe('- **Maybe:** not an option.');
  });

  it('returns nothing for an absent context', () => {
    expect(liftOptionConsequences(undefined, ['Yes'])).toEqual({ consequences: {}, remainingContext: undefined });
  });
});
