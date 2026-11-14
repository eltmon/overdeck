/**
 * PAN-5232: `herdrPaneReadText` accepts herdr 0.9.1's `{ read: { text } }`
 * shape and the legacy `{ text }` shape, never throws, and warns once per
 * process on an unrecognized shape.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { herdrPaneReadText, resetHerdrPaneReadWarningForTests } from '../../../../src/lib/terminal-backends/herdr-pane-read.js';

beforeEach(() => {
  resetHerdrPaneReadWarningForTests();
});

describe('herdrPaneReadText', () => {
  it('returns read.text for the herdr 0.9.1 shape', () => {
    const result = { type: 'pane_read', read: { pane_id: 'w2:p7C', text: 'abc\n' } };
    expect(herdrPaneReadText(result)).toBe('abc\n');
  });

  it('returns text for the legacy shape', () => {
    expect(herdrPaneReadText({ text: 'legacy' })).toBe('legacy');
  });

  it('prefers read.text when both shapes are present', () => {
    const result = { read: { text: 'from read' }, text: 'from legacy' };
    expect(herdrPaneReadText(result)).toBe('from read');
  });

  it.each([
    ['missing read', { type: 'pane_read' }],
    ['empty read object', { read: {} }],
    ['read.text not a string', { read: { text: 5 } }],
    ['null', null],
    ['undefined', undefined],
    ['a bare string', 'str'],
  ])('returns \'\' and does not throw for %s', (_label, result) => {
    expect(() => herdrPaneReadText(result)).not.toThrow();
    expect(herdrPaneReadText(result)).toBe('');
  });

  it('warns exactly once per process when two unrecognized results are parsed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    herdrPaneReadText({ unexpected: true });
    herdrPaneReadText({ other: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('PAN-5232');
    warn.mockRestore();
  });

  it('returns \'\' without warning for an empty read.text', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(herdrPaneReadText({ read: { text: '' } })).toBe('');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
