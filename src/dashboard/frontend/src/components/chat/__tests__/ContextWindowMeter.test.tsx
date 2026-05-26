import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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

function renderInContainer(width: number, usage: ContextWindowSnapshot | null = snapshot(22)) {
  return render(
    <div style={{ containerType: 'inline-size', width }}>
      <ContextWindowMeter usage={usage} />
    </div>,
  );
}

const meterCss = readFileSync(
  resolve(process.cwd(), 'src/components/chat/ContextWindowMeter.module.css'),
  'utf8',
);

describe('ContextWindowMeter', () => {
  it('renders nothing when usage is null', () => {
    const { container } = renderInContainer(1000, null);

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
    renderInContainer(1000, snapshot(usedPercentage));

    expect(screen.getByTestId('context-window-meter')).toHaveAttribute('data-tone', tone);
  });

  it('renders the wide variant slots for containers above 900px', () => {
    renderInContainer(1000, snapshot(22));

    // Tokens are formatted with t3code's algorithm — 33041 → '33k'.
    expect(screen.getByTestId('context-window-meter-size')).toHaveTextContent('33k');
    expect(screen.getByTestId('context-window-meter-percent')).toHaveTextContent('22%');
    expect(screen.getByTestId('context-window-meter-bar')).toBeInTheDocument();
  });

  it('defines the medium variant as size plus bar without percent or window text', () => {
    renderInContainer(720, snapshot(22));

    expect(screen.getByTestId('context-window-meter-size')).toHaveTextContent('33k');
    expect(screen.getByTestId('context-window-meter-bar')).toBeInTheDocument();
    expect(meterCss).toMatch(
      /@container \(max-width: 900px\)[\s\S]*\.percentText,\s*\.windowText\s*\{[\s\S]*display: none;/,
    );
  });

  it('defines the small variant as the dot only with the full value in the title', () => {
    renderInContainer(420, snapshot(22));

    expect(screen.getByTestId('context-window-meter-dot')).toBeInTheDocument();
    expect(screen.getByTestId('context-window-meter')).toHaveAttribute(
      'title',
      '33,041 active tokens (22%) of 200,000 context used',
    );
    expect(meterCss).toMatch(
      /@container \(max-width: 599px\)[\s\S]*\.sizeText,[\s\S]*\.barTrack\s*\{[\s\S]*display: none;/,
    );
    expect(meterCss).toMatch(
      /@container \(max-width: 599px\)[\s\S]*\.dot\s*\{[\s\S]*display: inline-block;/,
    );
  });

  it('sets progressbar accessibility values', () => {
    renderInContainer(1000, snapshot(22.4));

    const bar = screen.getByRole('progressbar', { name: 'Context window usage' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '22');
    expect(screen.getByTestId('context-window-meter-fill')).toHaveStyle({ width: '22.4%' });
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
    });
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
