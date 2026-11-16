import { describe, expect, it } from 'vitest';

import { formatSpec } from '../lib/shortcuts/keys';
import { TAB_PATHS } from './routes';
import { PALETTE_SEARCH_PLACEHOLDER, paletteKeycap, projectCrumbLabel, TAB_TITLES } from './appChromeLabels';

describe('projectCrumbLabel (PAN-5000)', () => {
  it('renders the No project deck as "No project"', () => {
    expect(projectCrumbLabel('__no-project__')).toBe('No project');
  });

  it('renders the All projects deck as "All projects" (PAN-5343)', () => {
    expect(projectCrumbLabel('__all-projects__')).toBe('All projects');
  });

  it('renders a registered project key as-is', () => {
    expect(projectCrumbLabel('overdeck')).toBe('overdeck');
  });
});

describe('top bar labels (PAN-5292)', () => {
  it('names what the palette searches in the search box', () => {
    expect(PALETTE_SEARCH_PLACEHOLDER).toBe('Search issues, conversations, commands…');
  });

  it('has a non-empty page title for every route', () => {
    for (const tab of Object.keys(TAB_PATHS) as Array<keyof typeof TAB_PATHS>) {
      expect(TAB_TITLES[tab]?.trim(), tab).toBeTruthy();
    }
    expect(Object.keys(TAB_TITLES).sort()).toEqual(Object.keys(TAB_PATHS).sort());
  });

  it('prints the palette keycap for each platform', () => {
    expect(paletteKeycap('other')).toBe(formatSpec('Ctrl+K', 'other'));
    expect(paletteKeycap('mac')).toBe(formatSpec('Meta+K', 'mac'));
  });
});
