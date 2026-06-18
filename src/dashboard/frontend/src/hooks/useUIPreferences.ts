import { useState, useCallback, useEffect, useRef } from 'react';

const STORAGE_KEY = 'overdeck.ui.preferences';
const CHANGE_EVENT = 'overdeck:ui-prefs-changed';

export interface UIPreferences {
  /** Shimmer animation on "READY TO MERGE" badges. Default: true */
  readyToMergeShimmer: boolean;
}

const DEFAULTS: UIPreferences = {
  readyToMergeShimmer: true,
};

function load(): UIPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function persist(prefs: UIPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // localStorage unavailable (private browsing, storage full) — ignore
  }
}

/**
 * Hook for reading and writing localStorage-backed UI preferences.
 * Changes dispatch a custom DOM event so all hook instances on the page
 * stay in sync without requiring a shared React context.
 */
export function useUIPreferences() {
  const [prefs, setPrefs] = useState<UIPreferences>(load);
  const isSourceRef = useRef(false);

  useEffect(() => {
    const handler = () => {
      if (isSourceRef.current) {
        isSourceRef.current = false;
        return;
      }
      setPrefs(load());
    };
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);

  const update = useCallback((patch: Partial<UIPreferences>) => {
    isSourceRef.current = true;
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  }, []);

  return { prefs, update };
}
