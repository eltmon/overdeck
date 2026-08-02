import { create } from 'zustand';

export type DesignLanguage = 'ledger' | 'broadsheet';

const STORAGE_KEY = 'overdeck.ui.designLanguage';

function getStoredDesignLanguage(): DesignLanguage {
  return localStorage.getItem(STORAGE_KEY) === 'ledger' ? 'ledger' : 'broadsheet';
}

function applyDesignLanguage(designLanguage: DesignLanguage) {
  document.documentElement.dataset.theme = designLanguage;
}

function storeDesignLanguage(designLanguage: DesignLanguage) {
  localStorage.setItem(STORAGE_KEY, designLanguage);
}

function parseResolvedDesignLanguage(payload: unknown): DesignLanguage {
  const theme = (payload as { ui?: { theme?: unknown } } | undefined)?.ui?.theme;
  return theme === 'ledger' ? 'ledger' : 'broadsheet';
}

applyDesignLanguage(getStoredDesignLanguage());

interface DesignLanguageState {
  designLanguage: DesignLanguage;
  setDesignLanguage: (designLanguage: DesignLanguage) => Promise<void>;
  reconcileFromServer: () => Promise<void>;
}

export const useDesignLanguage = create<DesignLanguageState>((set) => ({
  designLanguage: getStoredDesignLanguage(),

  // PUT /api/settings replaces the whole settings document (no server-side
  // partial merge), so — same as SettingsPage.tsx's saveSettings — read the
  // latest settings first and PUT them back with only ui.theme changed.
  setDesignLanguage: async (designLanguage: DesignLanguage) => {
    const getRes = await fetch('/api/settings');
    if (!getRes.ok) throw new Error(`Failed to fetch settings (HTTP ${getRes.status})`);
    const current = await getRes.json() as { ui?: { theme?: DesignLanguage } };

    const putRes = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...current, ui: { ...current.ui, theme: designLanguage } }),
    });
    if (!putRes.ok) throw new Error(`Failed to save ui.theme (HTTP ${putRes.status})`);

    applyDesignLanguage(designLanguage);
    storeDesignLanguage(designLanguage);
    set({ designLanguage });
  },

  // Reconciles the locally-mirrored design language against the server's
  // resolved config.yaml value on app mount — the mirror can be stale if
  // ui.theme was changed on another device/browser or edited directly in
  // config.yaml. Best-effort: a failed fetch keeps the locally-stamped value.
  reconcileFromServer: async () => {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const serverDesignLanguage = parseResolvedDesignLanguage(await res.json());
      applyDesignLanguage(serverDesignLanguage);
      storeDesignLanguage(serverDesignLanguage);
      set({ designLanguage: serverDesignLanguage });
    } catch {
      // Network unavailable — reconciliation is best-effort.
    }
  },
}));
