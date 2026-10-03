import { describe, expect, it } from 'vitest';
import { parseHandoffComposerArgs } from '../handoffComposerArgs';

describe('parseHandoffComposerArgs (PAN-4499 WI-9)', () => {
  it('extracts skills, packs and hold and keeps the focus', () => {
    expect(parseHandoffComposerArgs('do X --skill grilling --hold')).toEqual({
      focus: 'do X',
      skills: ['grilling'],
      packs: [],
      hold: true,
    });
    expect(parseHandoffComposerArgs('--skill grilling --pack mattpocock continue the work')).toEqual({
      focus: 'continue the work',
      skills: ['grilling'],
      packs: ['mattpocock'],
      hold: false,
    });
    expect(parseHandoffComposerArgs('--skill a --skill b fix it')).toEqual({
      focus: 'fix it',
      skills: ['a', 'b'],
      packs: [],
      hold: false,
    });
  });

  it('supports --flag=value', () => {
    expect(parseHandoffComposerArgs('--skill=grilling --pack=mattpocock do the thing')).toEqual({
      focus: 'do the thing',
      skills: ['grilling'],
      packs: ['mattpocock'],
      hold: false,
    });
  });

  it('text without flags is all focus', () => {
    expect(parseHandoffComposerArgs('just continue the work')).toEqual({
      focus: 'just continue the work',
      skills: [],
      packs: [],
      hold: false,
    });
    expect(parseHandoffComposerArgs(undefined)).toEqual({ focus: undefined, skills: [], packs: [], hold: false });
    expect(parseHandoffComposerArgs('   ')).toEqual({ focus: undefined, skills: [], packs: [], hold: false });
  });
});
