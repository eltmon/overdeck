/**
 * PAN-4753: Settings → Merge Train edits the two batch window keys through
 * POST /api/merge-train/config.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { toast } from 'sonner';
import { MergeTrainBatchingSection } from '../MergeTrainBatchingSection';
import { renderWithQuery, stubFetch } from '../../../flywheel/__tests__/fixtures';

const config = { auto_pickup_backlog: false, require_uat_before_merge: false, merge_train_enabled: true, batch_size: 3, batch_wait_minutes: 30 };

function setup() {
  return stubFetch((url, init) => {
    if (url === '/api/merge-train/config' && init?.method === 'POST') {
      return Response.json({ ...config, ...(JSON.parse(String(init.body)) as object) });
    }
    if (url === '/api/merge-train/config') return Response.json(config);
    return undefined;
  });
}

describe('MergeTrainBatchingSection (PAN-4753)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('shows the current batch size and wait', async () => {
    setup();
    renderWithQuery(<MergeTrainBatchingSection />);
    await waitFor(() => expect(screen.getByTestId('merge-train-batch-size')).toHaveValue(3));
    expect(screen.getByTestId('merge-train-batch-wait')).toHaveValue(30);
  });

  it('saves a new batch size on blur', async () => {
    const fetchMock = setup();
    renderWithQuery(<MergeTrainBatchingSection />);
    const size = screen.getByTestId('merge-train-batch-size');
    await waitFor(() => expect(size).toBeEnabled());
    fireEvent.change(size, { target: { value: '5' } });
    fireEvent.blur(size);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/merge-train/config', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ batch_size: 5 }),
    })));
  });

  it('refuses an out-of-range wait without posting', async () => {
    const fetchMock = setup();
    renderWithQuery(<MergeTrainBatchingSection />);
    const wait = screen.getByTestId('merge-train-batch-wait');
    await waitFor(() => expect(wait).toBeEnabled());
    fireEvent.change(wait, { target: { value: '0' } });
    fireEvent.blur(wait);
    expect(toast.error).toHaveBeenCalledWith('Batch wait (minutes) must be a whole number from 1 to 1440');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/merge-train/config', expect.objectContaining({ method: 'POST' }));
    expect(wait).toHaveValue(30);
  });
});
