import { create } from 'zustand';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport.js';

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

  // PUT /api/settings/design-language writes only `ui.theme`, read fresh and
  // saved server-side in one request — unlike a GET-then-PUT /api/settings
  // round trip, there is no client-held stale snapshot of every other field
  // that a concurrent settings save (another tab, or the top-level Settings
  // form) could be clobbered by (PAN-3410 review finding — no-loss guarantee,
  // FR-7). dashboardMutationJsonHeaders() mints the session and attaches the
  // CSRF token every other settings mutation carries (PAN-3410 review
  // finding — security).
  setDesignLanguage: async (designLanguage: DesignLanguage) => {
    const headers = await dashboardMutationJsonHeaders();
    const putRes = await fetch('/api/settings/design-language', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ theme: designLanguage }),
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
