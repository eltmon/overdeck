import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextWindowMeter } from '../ContextWindowMeter';
import {
  formatContextWindowTokens,
  toContextWindowSnapshot,
  type ContextWindowSnapshot,
} from '../../../lib/contextWindow';
import type { ContextUsage } from '../chat-types';

// t3code's ContextWindowSnapshot is the renderer's input. Construct one
// directly here (mirrors how t3code's tests work) rather than going through
// the server-shape adapter — adapter behavior has its own coverage below.
function snapshot(usedPercentage: number, usedTokens = 33_041): ContextWindowSnapshot {
  return {
    usedTokens,
    maxTokens: 200_000,
    usedPercentage,
    remainingTokens: 200_000 - usedTokens,
    remainingPercentage: 100 - usedPercentage,
    activeBytes: usedTokens * 4,
  };
}

describe('ContextWindowMeter (ring visual, mirrors t3code geometry)', () => {
  it('renders nothing when usage is null', () => {
    const { container } = render(<ContextWindowMeter usage={null} />);
    expect(container.querySelector('[data-testid="context-window-meter"]')).toBeNull();
  });

  it.each([
    [0, 'low'],
    [49, 'low'],
    [50, 'medium'],
    [79, 'medium'],
    [80, 'medium'],
    [99, 'high'],
  ] as const)('uses the %s%% threshold tone', (usedPercentage, tone) => {
    render(<ContextWindowMeter usage={snapshot(usedPercentage)} />);
    expect(screen.getByTestId('context-window-meter')).toHaveAttribute('data-tone', tone);
  });

  it('renders an SVG ring with a track + progress circle', () => {
    render(<ContextWindowMeter usage={snapshot(22)} />);

    const ring = screen.getByTestId('context-window-meter-ring');
    expect(ring.tagName.toLowerCase()).toBe('svg');
    expect(ring).toHaveAttribute('viewBox', '0 0 24 24');

    // Track + progress = 2 circles, both r=9.75.
    const circles = ring.querySelectorAll('circle');
    expect(circles).toHaveLength(2);
    circles.forEach((c) => expect(c.getAttribute('r')).toBe('9.75'));
  });

  it('sets strokeDashoffset proportional to usedPercentage', () => {
    // circumference = 2π * 9.75 ≈ 61.26
    // At 25% used, offset = circumference - 0.25 * circumference = 0.75 * 61.26 ≈ 45.94
    render(<ContextWindowMeter usage={snapshot(25)} />);
    const progress = screen.getByTestId('context-window-meter-progress');

    const expectedCircumference = 2 * Math.PI * 9.75;
    const expectedOffset = expectedCircumference - 0.25 * expectedCircumference;

    expect(Number(progress.getAttribute('stroke-dasharray'))).toBeCloseTo(expectedCircumference, 5);
    expect(Number(progress.getAttribute('stroke-dashoffset'))).toBeCloseTo(expectedOffset, 5);
  });

  it('clamps usedPercentage > 100 to a fully-drawn ring (offset = 0)', () => {
    render(
      <ContextWindowMeter
        usage={{
          usedTokens: 500_000,
          maxTokens: 200_000,
          usedPercentage: 250,
          remainingTokens: 0,
          remainingPercentage: 0,
        }}
      />,
    );
    const progress = screen.getByTestId('context-window-meter-progress');
    expect(Number(progress.getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 5);
  });

  it('shows rounded percent in the inner label', () => {
    render(<ContextWindowMeter usage={snapshot(22.4)} />);
    expect(screen.getByTestId('context-window-meter-label')).toHaveTextContent('22');
  });

  it('falls back to formatted token count when maxTokens is unknown', () => {
    render(
      <ContextWindowMeter
        usage={{
          usedTokens: 12_500,
          maxTokens: null,
          usedPercentage: null,
          remainingTokens: null,
          remainingPercentage: null,
        }}
      />,
    );
    // 12500 → "13k" via formatContextWindowTokens (rounded).
    expect(screen.getByTestId('context-window-meter-label')).toHaveTextContent('13k');
  });

  it('exposes a tooltip with percent + tokens when maxTokens known', () => {
    render(<ContextWindowMeter usage={snapshot(22)} />);
    expect(screen.getByTestId('context-window-meter')).toHaveAttribute(
      'title',
      '22% · 33k/200k context used · click for details',
    );
  });

  it('exposes a usage-only tooltip when maxTokens unknown', () => {
    render(
      <ContextWindowMeter
        usage={{
          usedTokens: 1_500,
          maxTokens: null,
          usedPercentage: null,
          remainingTokens: null,
          remainingPercentage: null,
        }}
      />,
    );
    expect(screen.getByTestId('context-window-meter')).toHaveAttribute(
      'title',
      '1.5k tokens used so far · click for details',
    );
  });

  it('opens a popover on click and closes on a second click', () => {
    render(<ContextWindowMeter usage={snapshot(22)} />);
    const trigger = screen.getByTestId('context-window-meter');

    expect(screen.queryByTestId('context-window-meter-popover')).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByTestId('context-window-meter-popover')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByTestId('context-window-meter-popover')).toBeNull();
  });

  it('renders the breakdown (input / cache-read / cache-create / remaining) in the popover', () => {
    render(
      <ContextWindowMeter
        usage={{
          ...snapshot(22),
          lastInputTokens: 4_200,
          lastCacheReadTokens: 26_000,
          lastCacheCreationTokens: 2_841,
          maxObservedInputTokens: 33_041,
          lastModel: 'claude-opus-4-7',
          lastTurnAt: '2026-05-26T14:30:00Z',
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('context-window-meter'));

    const popover = screen.getByTestId('context-window-meter-popover');
    expect(popover).toHaveTextContent('Input');
    expect(popover).toHaveTextContent('4.2k');
    expect(popover).toHaveTextContent('Cache read');
    expect(popover).toHaveTextContent('26k');
    expect(popover).toHaveTextContent('Cache create');
    expect(popover).toHaveTextContent('2.8k');
    expect(popover).toHaveTextContent('claude-opus-4-7');
  });

  it('shows the 1M-mode badge when maxTokens > 200k', () => {
    render(
      <ContextWindowMeter
        usage={{
          usedTokens: 340_000,
          maxTokens: 1_000_000,
          usedPercentage: 34,
          remainingTokens: 660_000,
          remainingPercentage: 66,
          maxObservedInputTokens: 340_000,
          lastInputTokens: 340_000,
          lastCacheReadTokens: 0,
          lastCacheCreationTokens: 0,
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('context-window-meter'));
    expect(screen.getByTestId('context-window-meter-popover')).toHaveTextContent('1M mode');
  });

  it('sets an aria-label describing the usage', () => {
    render(<ContextWindowMeter usage={snapshot(22)} />);
    expect(screen.getByTestId('context-window-meter')).toHaveAttribute(
      'aria-label',
      'Context window 22% used — click to expand',
    );
  });
});

describe('formatContextWindowTokens (mirrors t3code)', () => {
  it('returns "0" for null / non-finite', () => {
    expect(formatContextWindowTokens(null)).toBe('0');
    expect(formatContextWindowTokens(Number.NaN)).toBe('0');
  });

  it('formats values under 1000 as raw integers', () => {
    expect(formatContextWindowTokens(0)).toBe('0');
    expect(formatContextWindowTokens(512)).toBe('512');
    expect(formatContextWindowTokens(999)).toBe('999');
  });

  it('formats values under 10k with one decimal (trailing .0 dropped)', () => {
    expect(formatContextWindowTokens(1_000)).toBe('1k');
    expect(formatContextWindowTokens(4_200)).toBe('4.2k');
    expect(formatContextWindowTokens(9_999)).toBe('10k');
  });

  it('formats values under 1M as rounded thousands', () => {
    expect(formatContextWindowTokens(33_041)).toBe('33k');
    expect(formatContextWindowTokens(142_500)).toBe('143k');
    expect(formatContextWindowTokens(999_400)).toBe('999k');
  });

  it('formats values above 1M with one decimal millions', () => {
    expect(formatContextWindowTokens(1_400_000)).toBe('1.4m');
    expect(formatContextWindowTokens(1_530_000)).toBe('1.5m');
    expect(formatContextWindowTokens(2_000_000)).toBe('2m');
  });
});

describe('toContextWindowSnapshot (server→t3code adapter)', () => {
  it('returns null for null / undefined server payloads', () => {
    expect(toContextWindowSnapshot(null)).toBeNull();
    expect(toContextWindowSnapshot(undefined)).toBeNull();
  });

  it('maps server ContextUsage fields onto t3code field names', () => {
    const usage: ContextUsage = {
      activeBytes: 132_164,
      estimatedTokens: 33_041,
      contextWindow: 200_000,
      percentUsed: 22.4,
    };
    expect(toContextWindowSnapshot(usage)).toEqual({
      usedTokens: 33_041,
      maxTokens: 200_000,
      usedPercentage: 22.4,
      remainingTokens: 166_959,
      remainingPercentage: 77.6,
      activeBytes: 132_164,
      lastInputTokens: undefined,
      lastCacheReadTokens: undefined,
      lastCacheCreationTokens: undefined,
      maxObservedInputTokens: undefined,
      lastModel: undefined,
      lastTurnAt: undefined,
    });
  });

  it('passes the per-turn breakdown fields through to the snapshot', () => {
    const usage: ContextUsage = {
      activeBytes: 132_164,
      estimatedTokens: 33_041,
      contextWindow: 200_000,
      percentUsed: 22.4,
      lastInputTokens: 4_200,
      lastCacheReadTokens: 26_000,
      lastCacheCreationTokens: 2_841,
      maxObservedInputTokens: 33_041,
      lastModel: 'claude-opus-4-7',
      lastTurnAt: '2026-05-26T14:30:00Z',
    };
    const out = toContextWindowSnapshot(usage)!;
    expect(out.lastInputTokens).toBe(4_200);
    expect(out.lastCacheReadTokens).toBe(26_000);
    expect(out.lastCacheCreationTokens).toBe(2_841);
    expect(out.maxObservedInputTokens).toBe(33_041);
    expect(out.lastModel).toBe('claude-opus-4-7');
    expect(out.lastTurnAt).toBe('2026-05-26T14:30:00Z');
  });

  it('clamps usedPercentage to [0, 100]', () => {
    const overflow: ContextUsage = {
      activeBytes: 0,
      estimatedTokens: 500_000,
      contextWindow: 200_000,
      percentUsed: 250,
    };
    expect(toContextWindowSnapshot(overflow)?.usedPercentage).toBe(100);
  });

  it('reports null max/remaining when contextWindow is unknown (0)', () => {
    const noMax: ContextUsage = {
      activeBytes: 0,
      estimatedTokens: 1_000,
      contextWindow: 0,
      percentUsed: 0,
    };
    const out = toContextWindowSnapshot(noMax);
    expect(out?.maxTokens).toBeNull();
    expect(out?.usedPercentage).toBeNull();
    expect(out?.remainingTokens).toBeNull();
    expect(out?.remainingPercentage).toBeNull();
  });
});
