import { useEffect, useRef } from 'react';

export type ViewMode = 'conversation' | 'terminal';

/** Stamp the terminal-view click for the OVERDECK_TERMINAL_PROFILE latency probe. */
export function markTerminalClick(conversationName: string): void {
  const w = window as unknown as { __panTerminalClickAt?: number };
  w.__panTerminalClickAt = performance.now();
  try {
    if (localStorage.getItem('OVERDECK_TERMINAL_PROFILE') === '1') {
      console.log(`[xterm-click] conv=${conversationName} t=${w.__panTerminalClickAt.toFixed(1)}`);
    }
  } catch { /* ignore */ }
}

/**
 * The session is parked on a boot-blocking TUI screen (Claude first-run
 * onboarding, trust dialog) that only the terminal can answer — the chat view
 * has no transcript to render and its composer can't drive the screen. Switch
 * to terminal view once per episode; a manual switch back sticks until the
 * signal clears and fires again.
 */
export function useNeedsTerminalAutoSwitch(
  needsTerminal: boolean,
  viewMode: ViewMode,
  onViewModeChange: ((mode: ViewMode) => void) | undefined,
): void {
  const autoSwitchedRef = useRef(false);
  useEffect(() => {
    if (!needsTerminal) {
      autoSwitchedRef.current = false;
      return;
    }
    if (autoSwitchedRef.current) return;
    autoSwitchedRef.current = true;
    if (viewMode !== 'terminal') onViewModeChange?.('terminal');
  }, [needsTerminal, viewMode, onViewModeChange]);
}
