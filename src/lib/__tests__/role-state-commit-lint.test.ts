import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('role state-commit lint', () => {
  it('accepts the shipped roles without state commit instructions', () => {
    for (const role of ['plan', 'work', 'review', 'test', 'sequencer']) {
      const text = readFileSync(`roles/${role}.md`, 'utf8');
      expect(text).not.toMatch(/(git\s+(add|commit)|commit[^.]{0,40})(\.pan\/|\.beads\/)/i);
    }
  });
});
