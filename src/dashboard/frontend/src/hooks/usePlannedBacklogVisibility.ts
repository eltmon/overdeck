import { create } from 'zustand';

const STORAGE_KEY = 'overdeck.ui.showPlannedBacklog';

function getStoredVisibility(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

interface PlannedBacklogVisibilityState {
  showPlannedBacklog: boolean;
  toggleShowPlannedBacklog: () => void;
}

export const usePlannedBacklogVisibility = create<PlannedBacklogVisibilityState>((set, get) => ({
  showPlannedBacklog: getStoredVisibility(),

  toggleShowPlannedBacklog: () => {
    const showPlannedBacklog = !get().showPlannedBacklog;
    try {
      localStorage.setItem(STORAGE_KEY, String(showPlannedBacklog));
    } catch {
      // localStorage unavailable — keep the preference for this session
    }
    set({ showPlannedBacklog });
  },
}));
