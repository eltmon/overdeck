import { describe, expect, it } from 'vitest';
import { entryClickValue, resolveIssueTab } from './issueTabs';

describe('resolveIssueTab', () => {
  it.each([
    ['conversation', 'session', 'conversation', 'conversation'],
    ['session', 'session', 'conversation', 'conversation'],
    ['terminal', 'session', 'terminal', 'terminal'],
    ['tasks', 'tasks', null, 'tasks'],
    ['plan', 'plan', 'map', 'plan'],
    ['prd', 'plan', 'prd', 'prd'],
    ['files', 'changes', 'files', 'files'],
    ['changes', 'changes', 'files', 'files'],
    ['code', 'changes', 'checks', 'checks'],
    ['checks', 'changes', 'checks', 'checks'],
    ['artifacts', 'changes', 'artifacts', 'artifacts'],
    ['activity', 'activity', 'feed', 'activity'],
    ['timeline', 'activity', 'feed', 'activity'],
    ['history', 'activity', 'history', 'history'],
    ['discussion', 'discussion', null, 'discussion'],
    ['decisions', 'decisions', null, 'decisions'],
    ['skills', 'skills', null, 'skills'],
    ['overview', 'overview', null, 'overview'],
    ['costs', 'overview', null, 'overview'],
    ['ship', 'overview', null, 'overview'],
  ])('maps every tab value: %s', (value, entry, view, expected) => {
    expect(resolveIssueTab(value)).toEqual({ entry, view, value: expected });
  });

  it('returns null for an unknown value, an empty string, null, and the object-prototype names constructor and toString', () => {
    expect(resolveIssueTab('bogus')).toBeNull();
    expect(resolveIssueTab('')).toBeNull();
    expect(resolveIssueTab(null)).toBeNull();
    expect(resolveIssueTab('constructor')).toBeNull();
    expect(resolveIssueTab('toString')).toBeNull();
  });
});

describe('entryClickValue', () => {
  it('keeps the current view inside the entry', () => {
    expect(entryClickValue('session', 'terminal')).toBe('terminal');
    expect(entryClickValue('changes', 'checks')).toBe('checks');
  });

  it('returns the entry default from another tab', () => {
    expect(entryClickValue('changes', 'conversation')).toBe('files');
    expect(entryClickValue('activity', 'overview')).toBe('activity');
    expect(entryClickValue('overview', 'files')).toBe('overview');
  });
});
