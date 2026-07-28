import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RunSettingsPanel } from '../RunSettingsPanel';

describe('RunSettingsPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists an attributed DRAIN posture and its operator reason', async () => {
    const onChange = vi.fn(async () => {});
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={onChange}
    />);

    fireEvent.change(screen.getByLabelText('Posture reason'), { target: { value: 'Hold until main is green' } });
    fireEvent.click(screen.getByRole('button', { name: 'drain' }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith({
      posture: 'drain',
      postureReason: 'Hold until main is green',
    });
  });

  it('shows a saving spinner, then Saved, fading to idle after 1600ms', async () => {
    let resolveChange: () => void = () => {};
    const onChange = vi.fn(() => new Promise<void>((resolve) => { resolveChange = resolve; }));
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={onChange}
    />);

    fireEvent.change(screen.getByLabelText('Lane A concurrency'), { target: { value: '3' } });
    fireEvent.blur(screen.getByLabelText('Lane A concurrency'));

    expect(screen.getByText('Saving…')).toBeInTheDocument();

    await act(async () => {
      resolveChange();
      await Promise.resolve();
    });
    expect(screen.getByText('Saved ✓')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(screen.queryByText('Saved ✓')).not.toBeInTheDocument();
  });

  it('shows Retry on a failed save and resends the identical patch', async () => {
    const onChange = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(undefined);
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={onChange}
    />);

    fireEvent.change(screen.getByLabelText('Lane A concurrency'), { target: { value: '5' } });
    fireEvent.blur(screen.getByLabelText('Lane A concurrency'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Couldn't save")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onChange).toHaveBeenNthCalledWith(2, { laneAConcurrency: 5 });

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Saved ✓')).toBeInTheDocument();
  });

  it('renders the last-saved footer time only after a successful save', async () => {
    vi.setSystemTime(new Date('2026-07-28T20:15:42.000Z'));
    const onChange = vi.fn(async () => {});
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={onChange}
    />);

    expect(screen.getByText('last saved —')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Lane A concurrency'), { target: { value: '4' } });
    fireEvent.blur(screen.getByLabelText('Lane A concurrency'));

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('last saved 20:15:42Z')).toBeInTheDocument();
  });

  it('does not render a global saving/error line', () => {
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={vi.fn(async () => {})}
    />);

    expect(screen.queryByText('Saving settings…')).not.toBeInTheDocument();
  });
});
