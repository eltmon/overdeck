/**
 * localStorage for `react-resizable-panels` layouts on the Agents page
 * (PAN-4197). Every read and write is try/catch-guarded: storage can be
 * missing or throw (private windows, blocked site data), and a lost layout
 * only means the panes open at their default sizes.
 */
import type { LayoutStorage } from 'react-resizable-panels';

export const guardedLayoutStorage: LayoutStorage = {
  getItem: (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // A layout that cannot be saved reopens at the default sizes.
    }
  },
};
