import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ForecastBar } from './ForecastBar';
import { HistorySection } from './HistorySection';
import type { ResourceHistorySnapshot } from '../../types';

describe('HistorySection', () => {
  it('renders CPU/memory chart and one marker per annotation', () => {
    render(<HistorySection history={historyFixture()} />);

    expect(screen.getByLabelText('Resource history chart')).toBeTruthy();
    expect(document.querySelectorAll('.history-marker')).toHaveLength(2);
  });

  it('scrolls and highlights a targeted agent annotation', () => {
    const onHighlightTarget = vi.fn();
    const target = document.createElement('div');
    target.dataset.resourceTarget = 'agent:agent-pan-1';
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);

    render(<HistorySection history={historyFixture()} onHighlightTarget={onHighlightTarget} />);
    fireEvent.click(screen.getByText('agent spike'));

    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(onHighlightTarget).toHaveBeenCalledWith('agent:agent-pan-1');
    target.remove();
  });

  it('renders forecast RAM and load with approximate fits verdict', () => {
    render(
      <ForecastBar
        forecast={{
          stacks: [{ stackId: 'PAN-1', issueId: 'PAN-1', composeProject: 'feature-pan-1', predictedRamBytes: 2 * 1024 ** 3, predictedLoad: 12, approximate: true, source: 'last-run-peak' }],
          headroom: { freeRamBytes: 4 * 1024 ** 3, loadHeadroom: 40 },
        }}
      />,
    );

    expect(screen.getByText(/≈ \+2 GB RAM, \+12 load → fits/)).toBeTruthy();
  });
});

function historyFixture(): ResourceHistorySnapshot {
  return {
    startedAt: '2026-07-07T00:00:00.000Z',
    cpu: [
      { ts: '2026-07-07T00:00:00.000Z', value: 10 },
      { ts: '2026-07-07T01:00:00.000Z', value: 30 },
    ],
    mem: [
      { ts: '2026-07-07T00:00:00.000Z', value: 40 },
      { ts: '2026-07-07T01:00:00.000Z', value: 60 },
    ],
    annotations: [
      { ts: '2026-07-07T00:30:00.000Z', label: 'agent spike', targetKind: 'agent', targetId: 'agent-pan-1' },
      { ts: '2026-07-07T00:45:00.000Z', label: 'stack stopped', targetKind: 'stack', targetId: 'PAN-2' },
    ],
  };
}
