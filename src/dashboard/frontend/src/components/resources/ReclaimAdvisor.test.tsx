import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReclaimAdvisor } from './ReclaimAdvisor';
import type { ReclaimCandidate } from '../../types';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReclaimAdvisor', () => {
  it('renders totals and candidate rows, and hides below the server threshold', () => {
    const { rerender } = render(<ReclaimAdvisor candidates={candidates()} totals={{ ramBytes: 9 * gb, diskBytes: 52 * gb }} thresholdBytes={500 * 1024 ** 2} />);

    expect(screen.getByText('9 GB RAM · 52 GB disk safe to free')).toBeTruthy();
    expect(screen.getByText('MIN-857')).toBeTruthy();
    expect(screen.getByText('venv cache')).toBeTruthy();

    rerender(<ReclaimAdvisor candidates={candidates()} totals={{ ramBytes: 1, diskBytes: 1 }} thresholdBytes={500 * 1024 ** 2} />);
    expect(screen.queryByText('Reclaim advisor')).toBeNull();
  });

  it('runs reclaim-all sequentially and renders progress states', async () => {
    const estimate = deferredResponse();
    const teardown = deferredResponse();
    const venv = deferredResponse();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => estimate.promise)
      .mockImplementationOnce(() => teardown.promise)
      .mockImplementationOnce(() => venv.promise);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ReclaimAdvisor candidates={candidates()} totals={{ ramBytes: 9 * gb, diskBytes: 52 * gb }} thresholdBytes={1} />);
    fireEvent.click(screen.getByText('Reclaim all safe'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/resources/stacks/MIN-857/teardown-estimate', { method: 'GET' });
    expect(screen.getByText('running')).toBeTruthy();
    await act(async () => estimate.resolve(new Response(JSON.stringify({ composeProject: 'feature-min-857', confirmToken: 'confirm-1' }), { status: 200 })));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/resources/stacks/MIN-857/teardown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmToken: 'confirm-1', typedText: 'feature-min-857' }),
    });
    expect(screen.queryByText('done')).toBeNull();
    await act(async () => teardown.resolve(new Response('{}', { status: 200 })));
    await waitFor(() => expect(screen.getByText('done')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => venv.resolve(new Response('{}', { status: 200 })));
    await waitFor(() => expect(screen.getAllByText('done')).toHaveLength(2));
  });

  it('stops at a failing candidate and preserves prior done state', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ composeProject: 'feature-min-857', confirmToken: 'confirm-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ReclaimAdvisor candidates={candidates()} totals={{ ramBytes: 9 * gb, diskBytes: 52 * gb }} thresholdBytes={1} />);
    fireEvent.click(screen.getByText('Reclaim all safe'));

    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
    expect(screen.getByText('done')).toBeTruthy();
    expect(screen.getByText('error')).toBeTruthy();
  });

  it('does not call endpoints when confirmation is cancelled', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<ReclaimAdvisor candidates={candidates()} totals={{ ramBytes: 9 * gb, diskBytes: 52 * gb }} thresholdBytes={1} />);
    fireEvent.click(screen.getByText('Reclaim all safe'));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs an individual non-stack candidate from its row action', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    render(<ReclaimAdvisor candidates={candidates()} totals={{ ramBytes: 9 * gb, diskBytes: 52 * gb }} thresholdBytes={1} />);
    fireEvent.click(screen.getByText('Delete venvs'));

    await waitFor(() => expect(screen.getByText('done')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/resources/venvs/MIN-857', { method: 'DELETE' });
  });

  it('runs an individual stack candidate through teardown before marking done', async () => {
    const estimate = deferredResponse();
    const teardown = deferredResponse();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => estimate.promise)
      .mockImplementationOnce(() => teardown.promise);

    render(<ReclaimAdvisor candidates={candidates()} totals={{ ramBytes: 9 * gb, diskBytes: 52 * gb }} thresholdBytes={1} />);
    fireEvent.click(screen.getByText('Stop stack'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => estimate.resolve(new Response(JSON.stringify({ composeProject: 'feature-min-857', confirmToken: 'confirm-1' }), { status: 200 })));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('done')).toBeNull();
    await act(async () => teardown.resolve(new Response('{}', { status: 200 })));
    await waitFor(() => expect(screen.getByText('done')).toBeTruthy());
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/resources/stacks/MIN-857/teardown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmToken: 'confirm-1', typedText: 'feature-min-857' }),
    });
  });
});

const gb = 1024 ** 3;

function candidates(): ReclaimCandidate[] {
  return [
    { kind: 'stack', label: 'MIN-857', why: 'merged', ramBytes: 9 * gb, diskBytes: 0, action: 'GET /api/resources/stacks/MIN-857/teardown-estimate', issueId: 'MIN-857' },
    { kind: 'venv', label: 'venv cache', why: 'closed issue', ramBytes: 0, diskBytes: 52 * gb, action: 'DELETE /api/resources/venvs/MIN-857', issueId: 'MIN-857' },
  ];
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
