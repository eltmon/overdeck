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

  it('persists an attributed DRAIN posture and its operator reason via the atomic confirm', async () => {
    const onChange = vi.fn(async () => {});
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={onChange}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'drain' }));
    fireEvent.change(screen.getByLabelText('Posture reason'), { target: { value: 'Hold until main is green' } });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to drain' }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith({
      posture: 'drain',
      postureReason: 'Hold until main is green',
    });
  });

  it('renders the active posture with tinted styling and aria-pressed in both directions', () => {
    const { rerender } = render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={vi.fn(async () => {})}
    />);

    expect(screen.getByRole('button', { name: 'open' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'open' }).className).toContain('bg-info/[0.08]');
    expect(screen.getByRole('button', { name: 'drain' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'drain' }).className).not.toContain('bg-warning/[0.08]');

    rerender(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'drain' }}
      onChange={vi.fn(async () => {})}
    />);

    expect(screen.getByRole('button', { name: 'drain' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'drain' }).className).toContain('bg-warning/[0.08]');
    expect(screen.getByRole('button', { name: 'open' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'open' }).className).not.toContain('bg-info/[0.08]');
  });

  it('collapses the confirm on Cancel with no save, and renders no standalone reason input', () => {
    const onChange = vi.fn(async () => {});
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={onChange}
    />);

    expect(screen.queryByLabelText('Posture reason')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'drain' }));
    expect(screen.getByLabelText('Posture reason')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Posture reason')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('prefills the confirm reason and consequence copy for the clicked target', () => {
    const { rerender } = render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={vi.fn(async () => {})}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'drain' }));
    expect(screen.getByLabelText('Posture reason')).toHaveValue('Operator paused new pickup.');
    expect(screen.getByText(/In-flight items will finish/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to drain' })).toBeInTheDocument();

    rerender(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'drain' }}
      onChange={vi.fn(async () => {})}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByLabelText('Posture reason')).toHaveValue('Operator reopened pickup.');
    expect(screen.getByText(/Eligible items will start dispatching again/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen pickup' })).toBeInTheDocument();
  });

  it('renders attribution (who, when, reason) whenever the panel renders', () => {
    render(<RunSettingsPanel
      settings={{
        laneAConcurrency: 2,
        posture: 'drain',
        postureSetBy: 'eltmon',
        postureSetAt: '2026-07-19T07:21:00.000Z',
        postureReason: 'Hold until main is green',
      }}
      onChange={vi.fn(async () => {})}
    />);

    expect(screen.getByText('eltmon')).toBeInTheDocument();
    expect(screen.getByText('· Jul 19, 07:21Z')).toBeInTheDocument();
    expect(screen.getByText('— "Hold until main is green"')).toBeInTheDocument();
  });

  it('renders the stale-reason tag when the reason describes the opposite posture default', () => {
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open', postureReason: 'Operator paused new pickup.' }}
      onChange={vi.fn(async () => {})}
    />);

    const tag = screen.getByText('stale reason');
    expect(tag).toBeInTheDocument();
    expect(tag).toHaveAttribute(
      'title',
      'This reason was recorded before the current posture was set — it describes a previous state.',
    );
  });

  it('renders no stale tag and falls back to operator/no-reason-recorded when attribution is absent', () => {
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={vi.fn(async () => {})}
    />);

    expect(screen.queryByText('stale reason')).not.toBeInTheDocument();
    expect(screen.getByText('operator')).toBeInTheDocument();
    expect(screen.getByText('— "No reason recorded."')).toBeInTheDocument();
  });

  it('renders no stale tag when the reason matches the current posture default', () => {
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'drain', postureReason: 'Operator paused new pickup.' }}
      onChange={vi.fn(async () => {})}
    />);

    expect(screen.queryByText('stale reason')).not.toBeInTheDocument();
  });

  it('shows a saving spinner, then Saved, fading to idle after 1600ms', async () => {
    let resolveChange: () => void = () => {};
    const onChange = vi.fn(() => new Promise<void>((resolve) => { resolveChange = resolve; }));
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={onChange}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Increase Lane A concurrency' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

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

    fireEvent.click(screen.getByRole('button', { name: 'Increase Lane A concurrency' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Couldn't save")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onChange).toHaveBeenNthCalledWith(2, { laneAConcurrency: 3 });

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

    fireEvent.click(screen.getByRole('button', { name: 'Increase Lane A concurrency' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('last saved 20:15:42Z')).toBeInTheDocument();
  });

  it('debounces two rapid increments into a single patch', async () => {
    const onChange = vi.fn(async () => {});
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 1, posture: 'open' }}
      onChange={onChange}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Increase Lane A concurrency' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase Lane A concurrency' }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({ laneAConcurrency: 3 });
  });

  it('disables the decrement button at 1 and the increment button at 8', () => {
    const { rerender } = render(<RunSettingsPanel
      settings={{ laneAConcurrency: 1, posture: 'open' }}
      onChange={vi.fn(async () => {})}
    />);
    expect(screen.getByRole('button', { name: 'Decrease Lane A concurrency' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase Lane A concurrency' })).toBeEnabled();

    rerender(<RunSettingsPanel
      settings={{ laneAConcurrency: 8, posture: 'open' }}
      onChange={vi.fn(async () => {})}
    />);
    expect(screen.getByRole('button', { name: 'Increase Lane A concurrency' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decrease Lane A concurrency' })).toBeEnabled();
  });

  it('renders the Lane A/Lane B hint copy', () => {
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={vi.fn(async () => {})}
    />);

    expect(screen.getByText(/Lane B ignores this — it is always one item at a time, in order\./)).toBeInTheDocument();
  });

  it('shows an inline error for a non-markdown path and never calls onChange', async () => {
    const onChange = vi.fn(async () => {});
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={onChange}
    />);

    fireEvent.change(screen.getByLabelText('Brief overlay'), { target: { value: 'notes.txt' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(550);
    });

    expect(screen.getByText('Not a markdown file — expected a repo-relative .md path.')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('saves a valid markdown path and shows the success status', async () => {
    const onChange = vi.fn(async () => {});
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={onChange}
    />);

    fireEvent.change(screen.getByLabelText('Brief overlay'), { target: { value: 'docs/briefs/x.md' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(550);
    });

    expect(onChange).toHaveBeenCalledWith({ briefOverlay: 'docs/briefs/x.md' });
    expect(screen.getByText("Appended to every item's kickoff brief.")).toBeInTheDocument();
  });

  it('persists an explicit clear of a previously set overlay', async () => {
    const onChange = vi.fn(async () => {});
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open', briefOverlay: 'docs/briefs/old.md' }}
      onChange={onChange}
    />);

    fireEvent.change(screen.getByLabelText('Brief overlay'), { target: { value: '' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(550);
    });

    expect(onChange).toHaveBeenCalledWith({ briefOverlay: '' });
    expect(screen.getByText('None — items run with their PRDs alone.')).toBeInTheDocument();
  });

  it('does not render a global saving/error line', () => {
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={vi.fn(async () => {})}
    />);

    expect(screen.queryByText('Saving settings…')).not.toBeInTheDocument();
  });
});
