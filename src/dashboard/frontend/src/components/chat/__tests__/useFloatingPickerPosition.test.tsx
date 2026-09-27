import { act, render } from '@testing-library/react';
import { useRef, useState, type CSSProperties } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useFloatingPickerPosition } from '../useFloatingPickerPosition';

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function makeRect(partial: { left: number; top: number; width: number; height: number }): Rect {
  return {
    left: partial.left,
    top: partial.top,
    width: partial.width,
    height: partial.height,
    right: partial.left + partial.width,
    bottom: partial.top + partial.height,
  };
}

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height });
}

describe('useFloatingPickerPosition', () => {
  let originalGetBoundingClientRect: typeof HTMLElement.prototype.getBoundingClientRect;
  let anchorRect: Rect;

  beforeEach(() => {
    setViewport(1512, 982);
    anchorRect = makeRect({ left: 0, top: 0, width: 100, height: 36 });
    originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.dataset.role === 'anchor') {
        return {
          ...anchorRect,
          x: anchorRect.left,
          y: anchorRect.top,
          toJSON: () => anchorRect,
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    };
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  function setup(dropdownWidth: number) {
    let latestStyle: CSSProperties = {};
    let anchorParentEl: HTMLDivElement | null = null;
    let dropdownEl: HTMLDivElement | null = null;
    let externalSetOpen: (open: boolean) => void = () => {};

    function Harness() {
      const [open, setOpen] = useState(false);
      externalSetOpen = setOpen;
      const anchorRef = useRef<HTMLDivElement>(null);
      const dropdownRef = useRef<HTMLDivElement>(null);
      const { style } = useFloatingPickerPosition(open, anchorRef, dropdownRef);
      latestStyle = style;
      return (
        <div
          ref={(el) => {
            anchorParentEl = el;
          }}
          style={{ overflowX: 'hidden' }}
        >
          <div ref={anchorRef} data-role="anchor" />
          <div
            ref={(el) => {
              dropdownRef.current = el;
              dropdownEl = el;
            }}
            data-role="dropdown"
          />
        </div>
      );
    }

    render(<Harness />);
    if (dropdownEl) {
      Object.defineProperty(dropdownEl, 'offsetWidth', { value: dropdownWidth, configurable: true });
    }

    return {
      style: () => latestStyle,
      anchorParent: () => anchorParentEl as HTMLDivElement,
      setOpen: (open: boolean) => {
        act(() => {
          externalSetOpen(open);
        });
      },
    };
  }

  it('aligns the left edge with the anchor when it fits', () => {
    anchorRect = makeRect({ left: 600, top: 100, width: 120, height: 36 });
    const harness = setup(460);

    harness.setOpen(true);

    expect(harness.style().left).toBe(600);
    expect(harness.style().top).toBe(anchorRect.bottom + 4);
  });

  it('aligns the right edge with the anchor when the left alignment would overflow', () => {
    anchorRect = makeRect({ left: 1380, top: 100, width: 120, height: 36 });
    const harness = setup(460);

    harness.setOpen(true);

    expect(harness.style().left).toBe(1500 - 460);
  });

  it('clamps into the left gutter when the anchor is near the left edge', () => {
    anchorRect = makeRect({ left: 2, top: 100, width: 120, height: 36 });
    const harness = setup(460);

    harness.setOpen(true);

    expect(harness.style().left).toBe(8);
  });

  it('opens upward and anchors to the bottom when there is too little space below', () => {
    anchorRect = makeRect({ left: 600, top: 900, width: 120, height: 36 });
    const harness = setup(460);

    harness.setOpen(true);

    expect(harness.style().top).toBe('auto');
    expect(harness.style().bottom).toBe(982 - 900 + 4);
  });

  it('repositions on window resize', () => {
    anchorRect = makeRect({ left: 600, top: 100, width: 120, height: 36 });
    const harness = setup(460);
    harness.setOpen(true);
    expect(harness.style().left).toBe(600);

    anchorRect = makeRect({ left: 200, top: 100, width: 120, height: 36 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(harness.style().left).toBe(200);
  });

  it('resets a clipped ancestor scroll when the picker closes', () => {
    anchorRect = makeRect({ left: 600, top: 100, width: 120, height: 36 });
    const harness = setup(460);
    harness.setOpen(true);

    const parent = harness.anchorParent();
    Object.defineProperty(parent, 'scrollLeft', { value: 50, writable: true, configurable: true });

    harness.setOpen(false);

    expect(parent.scrollLeft).toBe(0);
  });
});
