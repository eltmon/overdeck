import { describe, expect, it, vi, afterEach } from 'vitest';

import { openSettingsSection, SETTINGS_SECTION_EVENT, SETTINGS_SECTION_INTENT_KEY } from '../settingsSection';

afterEach(() => {
  sessionStorage.removeItem(SETTINGS_SECTION_INTENT_KEY);
  vi.restoreAllMocks();
});

describe('openSettingsSection (PAN-4869 D9)', () => {
  it('navigates to /settings from another page', () => {
    window.history.replaceState({}, '', '/command-deck');
    const popstateListener = vi.fn();
    window.addEventListener('popstate', popstateListener);

    openSettingsSection('access-tokens');

    expect(window.location.pathname).toBe('/settings');
    expect(popstateListener).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(SETTINGS_SECTION_INTENT_KEY)).toBe('access-tokens');

    window.removeEventListener('popstate', popstateListener);
  });

  it('on /settings does not push history', () => {
    window.history.replaceState({}, '', '/settings');
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    const eventListener = vi.fn();
    window.addEventListener(SETTINGS_SECTION_EVENT, eventListener);

    openSettingsSection('access-tokens');

    expect(pushStateSpy).toHaveBeenCalledTimes(0);
    expect(eventListener).toHaveBeenCalledTimes(1);
    expect((eventListener.mock.calls[0]![0] as CustomEvent).detail).toBe('access-tokens');

    window.removeEventListener(SETTINGS_SECTION_EVENT, eventListener);
  });
});
