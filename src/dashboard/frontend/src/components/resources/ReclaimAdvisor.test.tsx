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
    const first = deferredResponse();
    const second = deferredResponse();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ReclaimAdvisor candidates={candidates()} totals={{ ramBytes: 9 * gb, diskBytes: 52 * gb }} thresholdBytes={1} />);
    fireEvent.click(screen.getByText('Reclaim all safe'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('running')).toBeTruthy();
    await act(async () => first.resolve(new Response('{}', { status: 200 })));
    await waitFor(() => expect(screen.getByText('done')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve(new Response('{}', { status: 200 })));
    await waitFor(() => expect(screen.getAllByText('done')).toHaveLength(2));
  });

  it('stops at a failing candidate and preserves prior done state', async () => {
    vi.spyOn(globalThis, 'fetch')
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
