/**
 * PAN-4849 WI-5: Deft's deterministic menu (numbered, ending Discuss/Back)
 * is recognized in assistant text and kept verbatim.
 */
import { describe, expect, it } from 'vitest';
import { parseDeftMenu } from '../menu-parser.js';

const MENU = [
  'The scope is ready for review.',
  '',
  'How do you want to proceed?',
  '1. Accept',
  '2. Approve with changes',
  '3. Reject',
  '4. Discuss',
  '5. Back',
].join('\n');

describe('parseDeftMenu', () => {
  it('parses a canonical five-option menu with Discuss and Back last', () => {
    expect(parseDeftMenu(MENU)).toEqual({
      prompt: 'How do you want to proceed?',
      options: ['1. Accept', '2. Approve with changes', '3. Reject', '4. Discuss', '5. Back'],
    });
  });

  it('returns null for a numbered list without Discuss and Back', () => {
    expect(parseDeftMenu('Steps:\n1. Build\n2. Test\n3. Ship')).toBeNull();
  });

  it('returns null for a numbering gap', () => {
    expect(parseDeftMenu('Pick one:\n1. Accept\n3. Reject\n4. Discuss\n5. Back')).toBeNull();
  });

  it('returns null for fewer than three options', () => {
    expect(parseDeftMenu('Pick:\n1. Discuss\n2. Back')).toBeNull();
  });

  it('still parses when trailing prose follows the menu within the last 40 lines', () => {
    const text = `${MENU}\n\nReply with the number or the exact label.\nI will wait for your choice.`;
    expect(parseDeftMenu(text)?.options.at(-1)).toBe('5. Back');
  });

  it('ignores a menu that scrolled out of the last 40 lines', () => {
    const text = `${MENU}\n${Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')}`;
    expect(parseDeftMenu(text)).toBeNull();
  });

  it('uses an empty prompt when nothing is above the menu', () => {
    expect(parseDeftMenu('1. Go\n2. Discuss\n3. Back')).toEqual({ prompt: '', options: ['1. Go', '2. Discuss', '3. Back'] });
  });
});
