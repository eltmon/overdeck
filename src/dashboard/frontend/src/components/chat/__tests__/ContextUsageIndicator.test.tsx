import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextUsageIndicator, formatCompactCount } from '../ContextUsageIndicator';
import type { ContextUsage } from '../chat-types';

function usage(percentUsed: number, estimatedTokens = 33_041): ContextUsage {
  return {
    activeBytes: estimatedTokens * 4,
    estimatedTokens,
    contextWindow: 200_000,
    percentUsed,
  };
}

function renderInContainer(width: number, contextUsage: ContextUsage | null = usage(22)) {
  return render(
    <div style={{ containerType: 'inline-size', width }}>
      <ContextUsageIndicator contextUsage={contextUsage} />
    </div>,
  );
}

const indicatorCss = readFileSync(
  resolve(process.cwd(), 'src/components/chat/ContextUsageIndicator.module.css'),
  'utf8',
);

describe('ContextUsageIndicator', () => {
  it('renders nothing when contextUsage is null', () => {
    const { container } = renderInContainer(1000, null);

    expect(container.querySelector('[data-testid="context-usage-indicator"]')).toBeNull();
  });

  it('formats compact counts', () => {
    expect(formatCompactCount(512)).toBe('512');
    expect(formatCompactCount(33_041)).toBe('33.04k');
    expect(formatCompactCount(1_530_000)).toBe('1.53M');
  });

  it.each([
    [0, 'low'],
    [49, 'low'],
    [50, 'medium'],
    [79, 'medium'],
    [80, 'medium'],
    [99, 'high'],
  ] as const)('uses the %s%% threshold tone', (percentUsed, tone) => {
    renderInContainer(1000, usage(percentUsed));

    expect(screen.getByTestId('context-usage-indicator')).toHaveAttribute('data-tone', tone);
  });

  it('renders the wide variant slots for containers above 900px', () => {
    renderInContainer(1000, usage(22));

    expect(screen.getByTestId('context-usage-size')).toHaveTextContent('33.04k');
    expect(screen.getByTestId('context-usage-percent')).toHaveTextContent('22%');
    expect(screen.getByTestId('context-usage-bar')).toBeInTheDocument();
  });

  it('defines the medium variant as size plus bar without percent or window text', () => {
    renderInContainer(720, usage(22));

    expect(screen.getByTestId('context-usage-size')).toHaveTextContent('33.04k');
    expect(screen.getByTestId('context-usage-bar')).toBeInTheDocument();
    expect(indicatorCss).toMatch(
      /@container \(max-width: 900px\)[\s\S]*\.percentText,\s*\.windowText\s*\{[\s\S]*display: none;/,
    );
  });

  it('defines the small variant as the dot only with the full value in the title', () => {
    renderInContainer(420, usage(22));

    expect(screen.getByTestId('context-usage-dot')).toBeInTheDocument();
    expect(screen.getByTestId('context-usage-indicator')).toHaveAttribute(
      'title',
      '33,041 active tokens (22%) of 200,000 context window',
    );
    expect(indicatorCss).toMatch(
      /@container \(max-width: 599px\)[\s\S]*\.sizeText,[\s\S]*\.barTrack\s*\{[\s\S]*display: none;/,
    );
    expect(indicatorCss).toMatch(
      /@container \(max-width: 599px\)[\s\S]*\.dot\s*\{[\s\S]*display: inline-block;/,
    );
  });

  it('sets progressbar accessibility values', () => {
    renderInContainer(1000, usage(22.4));

    const bar = screen.getByRole('progressbar', { name: 'Context usage' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '22');
    expect(screen.getByTestId('context-usage-fill')).toHaveStyle({ width: '22.4%' });
  });
});
