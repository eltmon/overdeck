/**
 * Panel helpers for the Agents page's `react-resizable-panels` layouts
 * (PAN-4197): layout storage and the separator's look.
 *
 * Storage is localStorage. Every read and write is try/catch-guarded: storage can be
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

/**
 * A 1px divider with an 8px invisible grab area (the ::before), a column-resize
 * cursor, and visible hover and drag states. Neutral, so blue keeps meaning
 * "live".
 */
export const PANEL_SEPARATOR_CLASS = [
  'relative w-px shrink-0 cursor-col-resize bg-border outline-none transition-colors',
  "before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-['']",
  'hover:bg-muted-foreground data-[separator=active]:bg-foreground data-[separator=focus]:bg-muted-foreground',
].join(' ');
