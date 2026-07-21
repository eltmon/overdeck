/**
 * PAN-2908 · C-SIMPLE — Get help routing tests.
 * The link must point at a NEW tracker issue referencing this task, never at
 * a dead end; unknown trackers yield null so the page renders plain text.
 */
import { describe, expect, it } from 'vitest';
import { getHelpUrl } from '../simple/helpUrl';

describe('getHelpUrl (C-SIMPLE)', () => {
  it('builds a prefilled GitHub new-issue URL from an issue URL', () => {
    const url = getHelpUrl({
      identifier: 'PAN-2908',
      title: 'Make overdeck not suck',
      url: 'https://github.com/eltmon/overdeck/issues/2908',
    });
    expect(url).toBe(
      `https://github.com/eltmon/overdeck/issues/new?title=${encodeURIComponent('[HELP] PAN-2908: Make overdeck not suck')}`,
    );
  });

  it('truncates very long titles so the URL stays well-formed', () => {
    const url = getHelpUrl({
      identifier: 'PAN-1',
      title: 'x'.repeat(500),
      url: 'https://github.com/a/b/issues/1',
    });
    expect(url).not.toBeNull();
    expect(decodeURIComponent(url!.replace('https://github.com/a/b/issues/new?title=', '')).length).toBeLessThanOrEqual(200);
  });

  it('routes Linear issues to the workspace new-issue page', () => {
    expect(
      getHelpUrl({ identifier: 'MIN-865', title: 'Thing', url: 'https://linear.app/mindyournow/issue/MIN-865/some-slug' }),
    ).toBe('https://linear.app/mindyournow/new');
  });

  it('returns null for unknown or missing tracker URLs', () => {
    expect(getHelpUrl({ identifier: 'X-1', title: 't', url: 'https://example.com/whatever' })).toBeNull();
    expect(getHelpUrl({ identifier: 'X-1', title: 't', url: null })).toBeNull();
    expect(getHelpUrl({ identifier: 'X-1', title: 't' })).toBeNull();
  });
});
