import { describe, expect, it } from 'vitest';

import { projectCrumbLabel, searchButtonText } from './appChromeLabels';

describe('projectCrumbLabel (PAN-5000)', () => {
  it('renders the No project deck as "No project"', () => {
    expect(projectCrumbLabel('__no-project__')).toBe('No project');
  });

  it('renders a registered project key as-is', () => {
    expect(projectCrumbLabel('overdeck')).toBe('overdeck');
  });
});

describe('searchButtonText (PAN-5000)', () => {
  it('shows the global placeholder for the No project deck', () => {
    expect(searchButtonText('__no-project__')).toBe('Search issues, conversations, commands…');
  });

  it('shows the global placeholder when no deck is selected', () => {
    expect(searchButtonText(null)).toBe('Search issues, conversations, commands…');
  });

  it('shows a project-scoped placeholder for a registered project key', () => {
    expect(searchButtonText('overdeck')).toBe('Search overdeck…');
  });
});
