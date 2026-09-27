/**
 * PAN-4266: a focused input inside an `overflow: hidden` column makes the
 * browser scroll that column sideways, and the user cannot scroll it back.
 * Reset horizontal scroll on every clipped ancestor. Never touches scrollTop
 * or real scroll containers (auto/scroll), so scrollable pages keep position.
 */
export function resetClippedAncestorScroll(start: HTMLElement | null): void {
  for (let el = start?.parentElement ?? null; el && el !== document.body; el = el.parentElement) {
    if (el.scrollLeft !== 0 && getComputedStyle(el).overflowX === 'hidden') el.scrollLeft = 0;
  }
}
