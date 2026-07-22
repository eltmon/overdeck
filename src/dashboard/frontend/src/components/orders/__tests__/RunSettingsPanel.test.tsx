import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RunSettingsPanel } from '../RunSettingsPanel';

describe('RunSettingsPanel', () => {
  it('persists an attributed DRAIN posture and its operator reason', async () => {
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
      postureReason: 'Hold until main is green',
    });
  });
});
