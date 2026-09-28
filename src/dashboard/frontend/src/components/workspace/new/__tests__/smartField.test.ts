import { describe, it, expect } from 'vitest';
import { classifySmartInput, toWorkspaceSlug } from '../smartField';

describe('classifySmartInput', () => {
  it('#12 is an issue', () => {
    expect(classifySmartInput('#12', [])).toEqual({ kind: 'issue', id: '#12' });
  });

  it('PAN-12 with prefix PAN is an issue', () => {
    expect(classifySmartInput('PAN-12', ['PAN'])).toEqual({ kind: 'issue', id: 'PAN-12' });
  });

  it('pan-12 with prefix PAN is issue PAN-12', () => {
    expect(classifySmartInput(' pan-12 ', ['PAN'])).toEqual({ kind: 'issue', id: 'PAN-12' });
  });

  it('XYZ-12 with prefix PAN is text', () => {
    expect(classifySmartInput('XYZ-12', ['PAN'])).toEqual({ kind: 'text' });
  });

  it('a GitHub issue URL is a url with its number', () => {
    expect(classifySmartInput('https://github.com/o/r/issues/12', [])).toEqual({
      kind: 'url',
      id: '#12',
      url: 'https://github.com/o/r/issues/12',
    });
    expect(classifySmartInput('https://github.com/o/r/pull/7', [])).toEqual({
      kind: 'url',
      id: '#7',
      url: 'https://github.com/o/r/pull/7',
    });
  });

  it('any other URL is a url without an id', () => {
    expect(classifySmartInput('https://example.com/x', [])).toEqual({ kind: 'url', url: 'https://example.com/x' });
  });

  it('plain text is text', () => {
    expect(classifySmartInput('fix login redirect bug', ['PAN'])).toEqual({ kind: 'text' });
  });
});

describe('toWorkspaceSlug', () => {
  it('slugs free text into a valid workspace name', () => {
    expect(toWorkspaceSlug('Fix login redirect bug!')).toBe('fix-login-redirect-bug');
  });
});
