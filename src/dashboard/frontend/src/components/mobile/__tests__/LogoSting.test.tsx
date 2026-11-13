import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, fireEvent, render } from '@testing-library/react';

import { FADE_MS, LOGO_STING_KEY, LogoSting, MIN_STING_MS, REDUCED_HOLD_MS, STING_MS } from '../LogoSting';

function stubReducedMotion(reduced: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduced && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })),
  );
}

function sting(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-component="logo-sting"]');
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const originalAnimate = Element.prototype.animate;

describe('LogoSting (PAN-5208)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    stubReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Element.prototype.animate = originalAnimate;
  });

  it('plays on the first mount, marks the session, fades at STING_MS and is removed after FADE_MS', () => {
    const { container, unmount } = render(<LogoSting ready={false} />);
    expect(sting(container)?.getAttribute('data-state')).toBe('playing');
    expect(sessionStorage.getItem(LOGO_STING_KEY)).toBe('1');

    advance(STING_MS - 1);
    expect(sting(container)?.getAttribute('data-state')).toBe('playing');
    advance(1);
    expect(sting(container)?.getAttribute('data-state')).toBe('fading');
    advance(FADE_MS);
    expect(sting(container)).toBeNull();
    unmount();

    const again = render(<LogoSting ready={false} />);
    expect(sting(again.container)).toBeNull();
  });

  it('holds until MIN_STING_MS when content is ready from the first render', () => {
    const { container } = render(<LogoSting ready />);
    advance(MIN_STING_MS - 1);
    expect(sting(container)?.getAttribute('data-state')).toBe('playing');
    advance(1);
    expect(sting(container)?.getAttribute('data-state')).toBe('fading');
  });

  it('fades as soon as content turns ready after MIN_STING_MS', () => {
    const { container, rerender } = render(<LogoSting ready={false} />);
    advance(1800);
    expect(sting(container)?.getAttribute('data-state')).toBe('playing');
    rerender(<LogoSting ready />);
    advance(0);
    expect(sting(container)?.getAttribute('data-state')).toBe('fading');
  });

  it('renders nothing when skipped and still marks the session', () => {
    const { container } = render(<LogoSting ready={false} skip />);
    expect(sting(container)).toBeNull();
    expect(sessionStorage.getItem(LOGO_STING_KEY)).toBe('1');
  });

  it('calls no animation under reduced motion and is removed after REDUCED_HOLD_MS with no fade', () => {
    stubReducedMotion(true);
    const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
    Element.prototype.animate = animate;
    const { container } = render(<LogoSting ready={false} />);
    expect(sting(container)?.getAttribute('data-state')).toBe('playing');
    advance(REDUCED_HOLD_MS - 1);
    expect(sting(container)?.getAttribute('data-state')).toBe('playing');
    advance(1);
    expect(sting(container)).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it('starts the five brand animations when motion is allowed', () => {
    const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
    Element.prototype.animate = animate;
    render(<LogoSting ready={false} />);
    expect(animate).toHaveBeenCalledTimes(5);
  });

  it('a tap while playing starts the fade before STING_MS', () => {
    const { container } = render(<LogoSting ready={false} />);
    advance(400);
    fireEvent.pointerDown(sting(container)!);
    expect(sting(container)?.getAttribute('data-state')).toBe('fading');
    advance(FADE_MS);
    expect(sting(container)).toBeNull();
  });

  it('plays and fades on time under React.StrictMode double effects', () => {
    const { container } = render(
      <StrictMode>
        <LogoSting ready />
      </StrictMode>,
    );
    expect(sting(container)?.getAttribute('data-state')).toBe('playing');
    advance(MIN_STING_MS);
    expect(sting(container)?.getAttribute('data-state')).toBe('fading');
    advance(FADE_MS);
    expect(sting(container)).toBeNull();
  });

  it('still plays when sessionStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    const { container } = render(<LogoSting ready={false} />);
    expect(sting(container)?.getAttribute('data-state')).toBe('playing');
  });
});
