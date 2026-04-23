import { useLayoutEffect, useState, type RefObject } from 'react';

export interface PickerPosition {
  openUp: boolean;
  align: 'left' | 'right';
  maxHeight: number;
}

interface Options {
  /** Estimated dropdown width for right-overflow detection. */
  estimatedWidth?: number;
  /** Ideal height; the dropdown will shrink below this if the viewport can't fit it. */
  preferredHeight?: number;
}

const GUTTER = 8;
const MIN_DOWN_HEIGHT = 240;

// Measure the button container's rect — it's stable regardless of dropdown direction.
// Measuring the dropdown's own rect causes an open/close toggle because the rect depends
// on whether the dropdown is positioned above or below, and that state persists.
export function usePickerPosition(
  open: boolean,
  containerRef: RefObject<HTMLDivElement | null>,
  { estimatedWidth = 280, preferredHeight = 400 }: Options = {},
): PickerPosition {
  const [position, setPosition] = useState<PickerPosition>({
    openUp: false,
    align: 'left',
    maxHeight: preferredHeight,
  });

  useLayoutEffect(() => {
    if (!open || !containerRef.current) return;

    const buttonRect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - buttonRect.bottom - GUTTER;
    const spaceAbove = buttonRect.top - GUTTER;

    const openUp = spaceBelow < Math.min(preferredHeight, MIN_DOWN_HEIGHT) && spaceAbove > spaceBelow;
    const align: 'left' | 'right' =
      buttonRect.left + estimatedWidth > window.innerWidth - GUTTER ? 'right' : 'left';
    const available = openUp ? spaceAbove : spaceBelow;

    setPosition({
      openUp,
      align,
      maxHeight: Math.max(120, Math.min(preferredHeight, available)),
    });
  }, [open, containerRef, estimatedWidth, preferredHeight]);

  return position;
}
