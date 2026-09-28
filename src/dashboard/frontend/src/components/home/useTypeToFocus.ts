/**
 * PAN-4280 (WI-10, FR-4) — "type and go": a printable key pressed anywhere on
 * the page body focuses the Home composer input, and the browser still
 * delivers the character to it because this hook never calls
 * preventDefault — it only moves focus before the keypress finishes.
 */
import { useEffect, type RefObject } from 'react';

export function useTypeToFocus(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.length !== 1) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.defaultPrevented) return;
      const active = document.activeElement;
      if (active !== document.body && active !== null) return;
      if (document.querySelector('[role="dialog"]')) return;
      ref.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [ref]);
}
