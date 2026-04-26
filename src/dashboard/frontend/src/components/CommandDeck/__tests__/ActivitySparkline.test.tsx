import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ActivitySparkline } from '../ActivitySparkline';

const NOW = 1714000000000; // fixed reference

describe('ActivitySparkline', () => {
  it('renders an SVG with the given dimensions', () => {
    const { getByTestId } = render(
      <ActivitySparkline events={[]} width={200} height={20} now={NOW} />,
    );
    const svg = getByTestId('activity-sparkline');
    expect(svg.getAttribute('width')).toBe('200');
    expect(svg.getAttribute('height')).toBe('20');
  });

  it('renders the configured number of bucket bars', () => {
    const { container } = render(
      <ActivitySparkline events={[]} buckets={8} now={NOW} />,
    );
    expect(container.querySelectorAll('rect')).toHaveLength(8);
  });

  it('uses default buckets=12 when not specified', () => {
    const { container } = render(<ActivitySparkline events={[]} now={NOW} />);
    expect(container.querySelectorAll('rect')).toHaveLength(12);
  });

  it('puts an event in the latest bucket when timestamp is now', () => {
    const { getByTestId } = render(
      <ActivitySparkline
        events={[{ timestamp: NOW - 1 }]}
        windowMinutes={60}
        buckets={12}
        now={NOW}
      />,
    );
    expect(getByTestId('sparkline-bar-11').getAttribute('data-count')).toBe('1');
    expect(getByTestId('sparkline-bar-0').getAttribute('data-count')).toBe('0');
  });

  it('puts an event in the earliest bucket when timestamp is at window start', () => {
    const { getByTestId } = render(
      <ActivitySparkline
        events={[{ timestamp: NOW - 60 * 60_000 + 1 }]}
        windowMinutes={60}
        buckets={12}
        now={NOW}
      />,
    );
    expect(getByTestId('sparkline-bar-0').getAttribute('data-count')).toBe('1');
    expect(getByTestId('sparkline-bar-11').getAttribute('data-count')).toBe('0');
  });

  it('drops events outside the window', () => {
    const { container } = render(
      <ActivitySparkline
        events={[
          { timestamp: NOW - 120 * 60_000 }, // 2h ago, outside 60m window
          { timestamp: NOW + 60_000 }, // future
        ]}
        windowMinutes={60}
        buckets={12}
        now={NOW}
      />,
    );
    const total = Array.from(container.querySelectorAll<SVGRectElement>('rect')).reduce(
      (sum, el) => sum + Number(el.getAttribute('data-count')),
      0,
    );
    expect(total).toBe(0);
  });

  it('aggregates multiple events in the same bucket', () => {
    const { getByTestId } = render(
      <ActivitySparkline
        events={[
          { timestamp: NOW - 1000 },
          { timestamp: NOW - 2000 },
          { timestamp: NOW - 3000 },
        ]}
        windowMinutes={60}
        buckets={12}
        now={NOW}
      />,
    );
    expect(getByTestId('sparkline-bar-11').getAttribute('data-count')).toBe('3');
  });

  it('respects per-event weight', () => {
    const { getByTestId } = render(
      <ActivitySparkline
        events={[{ timestamp: NOW - 1000, weight: 5 }]}
        windowMinutes={60}
        buckets={12}
        now={NOW}
      />,
    );
    expect(getByTestId('sparkline-bar-11').getAttribute('data-count')).toBe('5');
  });

  it('exposes data-buckets and data-window-minutes for the chart container', () => {
    const { getByTestId } = render(
      <ActivitySparkline events={[]} buckets={6} windowMinutes={30} now={NOW} />,
    );
    expect(getByTestId('activity-sparkline').getAttribute('data-buckets')).toBe('6');
    expect(getByTestId('activity-sparkline').getAttribute('data-window-minutes')).toBe('30');
  });

  it('applies primary fill on bars with events and border fill on empty bars', () => {
    const { container } = render(
      <ActivitySparkline
        events={[{ timestamp: NOW - 1000 }]}
        windowMinutes={60}
        buckets={4}
        now={NOW}
      />,
    );
    const bars = Array.from(container.querySelectorAll<SVGRectElement>('rect'));
    const last = bars[bars.length - 1]!;
    const first = bars[0]!;
    expect(last.getAttribute('fill')).toContain('primary');
    expect(first.getAttribute('fill')).toContain('border');
  });
});
