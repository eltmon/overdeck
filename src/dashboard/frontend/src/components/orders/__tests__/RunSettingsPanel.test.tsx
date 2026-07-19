import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunSettingsPanel } from '../RunSettingsPanel';

afterEach(() => vi.useRealTimers());

describe('RunSettingsPanel', () => {
  it('persists an attributed DRAIN posture and its operator reason', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T01:00:00.000Z'));
    const onChange = vi.fn(async () => {});
    render(<RunSettingsPanel
      settings={{ laneAConcurrency: 2, posture: 'open' }}
      onChange={onChange}
    />);

    fireEvent.change(screen.getByLabelText('Posture reason'), { target: { value: 'Hold until main is green' } });
    fireEvent.click(screen.getByRole('button', { name: 'drain' }));

    await Promise.resolve();
    expect(onChange).toHaveBeenCalledWith({
      posture: 'drain',
      postureSetAt: '2026-07-19T01:00:00.000Z',
      postureSetBy: 'operator',
      postureReason: 'Hold until main is green',
    });
  });
});
