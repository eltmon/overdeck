import { describe, expect, it } from 'vitest';
import { parseHandoffComposerArgs } from '../handoffComposerArgs';

describe('parseHandoffComposerArgs (PAN-4499 WI-9)', () => {
  it('extracts skills, packs and hold and keeps the focus', () => {
    expect(parseHandoffComposerArgs('do X --skill grilling --hold')).toEqual({
      focus: 'do X',
      skills: ['grilling'],
      packs: [],
      hold: true,
      fresh: false,
    });
    expect(parseHandoffComposerArgs('--skill grilling --pack mattpocock continue the work')).toEqual({
      focus: 'continue the work',
      skills: ['grilling'],
      packs: ['mattpocock'],
      hold: false,
      fresh: false,
    });
    expect(parseHandoffComposerArgs('--skill a --skill b fix it')).toEqual({
      focus: 'fix it',
      skills: ['a', 'b'],
      packs: [],
      hold: false,
      fresh: false,
    });
  });

  it('supports --flag=value', () => {
    expect(parseHandoffComposerArgs('--skill=grilling --pack=mattpocock do the thing')).toEqual({
      focus: 'do the thing',
      skills: ['grilling'],
      packs: ['mattpocock'],
      hold: false,
      fresh: false,
    });
  });

  it('text without flags is all focus', () => {
    expect(parseHandoffComposerArgs('just continue the work')).toEqual({
      focus: 'just continue the work',
      skills: [],
      packs: [],
      hold: false,
      fresh: false,
    });
    expect(parseHandoffComposerArgs(undefined)).toEqual({ focus: undefined, skills: [], packs: [], hold: false, fresh: false });
    expect(parseHandoffComposerArgs('   ')).toEqual({ focus: undefined, skills: [], packs: [], hold: false, fresh: false });
  });
});

describe('parseHandoffComposerArgs --fresh (PAN-4565)', () => {
  it('extracts --fresh and keeps the focus', () => {
    expect(parseHandoffComposerArgs('--fresh build a fort')).toEqual({
      focus: 'build a fort',
      skills: [],
      packs: [],
      hold: false,
      fresh: true,
    });
  });

  it('combines with --hold wherever the flags appear', () => {
    expect(parseHandoffComposerArgs('build a fort --fresh --hold')).toEqual({
      focus: 'build a fort',
      skills: [],
      packs: [],
      hold: true,
      fresh: true,
    });
  });

  it('leaves --freshly in the focus and fresh false with no token', () => {
    expect(parseHandoffComposerArgs('--freshly do the thing')).toEqual({
      focus: '--freshly do the thing',
      skills: [],
      packs: [],
      hold: false,
      fresh: false,
    });
    expect(parseHandoffComposerArgs('just continue the work')).toEqual({
      focus: 'just continue the work',
      skills: [],
      packs: [],
      hold: false,
      fresh: false,
    });
  });
});
