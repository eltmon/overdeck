import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { resetClippedAncestorScroll } from './resetClippedScroll';

export interface FloatingPickerOptions {
  /** Ideal height; the dropdown will shrink below this if the viewport can't fit it. */
  preferredHeight?: number;
}

const GUTTER = 8;
const GAP = 4;
const MIN_DOWN_HEIGHT = 240;

interface Measured {
  left: number;
  maxHeight: number;
  /** Distance from the viewport top, or null when the dropdown opens upward. */
  top: number | null;
  /** Distance from the viewport bottom, or null when the dropdown opens downward. */
  bottom: number | null;
}

const HIDDEN_STYLE: CSSProperties = { position: 'fixed', visibility: 'hidden', top: 0, left: 0 };

// Measure the anchor's rect and the dropdown's own width, never the dropdown's own rect —
// a portaled dropdown's rect depends on whether it opened above or below, which would make
// that choice toggle every measurement. See usePickerPosition.ts for the non-portaled sibling.
export function useFloatingPickerPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  dropdownRef: RefObject<HTMLElement | null>,
  { preferredHeight = 400 }: FloatingPickerOptions = {},
): { style: CSSProperties } {
  const [measured, setMeasured] = useState<Measured | null>(null);
  const wasOpenRef = useRef(false);

  useLayoutEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;

    if (!open) {
      if (wasOpen) resetClippedAncestorScroll(anchorRef.current);
      return;
    }

    const measure = () => {
      if (!anchorRef.current) return;
      const a = anchorRef.current.getBoundingClientRect();
      const w = dropdownRef.current?.offsetWidth ?? 0;

      const spaceBelow = window.innerHeight - a.bottom - GUTTER;
      const spaceAbove = a.top - GUTTER;
      const openUp = spaceBelow < Math.min(preferredHeight, MIN_DOWN_HEIGHT) && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(preferredHeight, (openUp ? spaceAbove : spaceBelow) - GAP));

      let left = a.left;
      if (left + w > window.innerWidth - GUTTER) left = a.right - w;
      left = Math.min(Math.max(left, GUTTER), Math.max(GUTTER, window.innerWidth - GUTTER - w));

      const next: Measured = openUp
        ? { left, maxHeight, top: null, bottom: window.innerHeight - a.top + GAP }
        : { left, maxHeight, top: a.bottom + GAP, bottom: null };

      setMeasured((prev) => {
        if (
          prev &&
          prev.left === next.left &&
          prev.maxHeight === next.maxHeight &&
          prev.top === next.top &&
          prev.bottom === next.bottom
        ) {
          return prev;
        }
        return next;
      });
    };

    measure();

    const onScroll = (e: Event) => {
      if (dropdownRef.current && e.target instanceof Node && dropdownRef.current.contains(e.target)) return;
      measure();
    };
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && dropdownRef.current) {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(dropdownRef.current);
    }

    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', onScroll, true);
      resizeObserver?.disconnect();
    };
  }, [open, anchorRef, dropdownRef, preferredHeight]);

  const style: CSSProperties = measured
    ? {
        position: 'fixed',
        left: measured.left,
        right: 'auto',
        maxHeight: measured.maxHeight,
        top: measured.top ?? 'auto',
        bottom: measured.bottom ?? 'auto',
      }
    : HIDDEN_STYLE;

  return { style };
}
