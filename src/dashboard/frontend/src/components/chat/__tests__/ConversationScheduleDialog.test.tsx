import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  ConversationScheduleDialogHost,
  ScheduleMenuItem,
  buildScheduleCron,
  openScheduleDialog,
  useScheduleDialogStore,
} from '../ConversationScheduleDialog';

// PAN-4657 WI-6: the Schedule dialog lists, creates, edits, pauses/resumes
// and deletes a conversation's recurring schedules.

const BASE = '/api/conversations/conv-a/schedules';
const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function schedule(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    conversationName: 'conv-a',
    conversationTitle: null,
    prompt: 'Summarize the day',
    cron: '0 21 * * *',
    timeZone: 'UTC',
    enabled: true,
    nextRunAt: '2026-11-03T21:00:00.000Z',
    lastRunAt: null,
    lastRunStatus: null,
    lastRunError: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  };
}

const fetchMock = vi.fn();
let view: { schedules: unknown[] };

function renderHost() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ConversationScheduleDialogHost /></QueryClientProvider>);
}

function renderHostWith(view_: { schedules: unknown[] }) {
  view = view_;
  renderHost();
}

beforeEach(() => {
  view = { schedules: [] };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (!init?.method || init.method === 'GET') return Response.json(view);
    return Response.json({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  act(() => useScheduleDialogStore.getState().close());
  vi.unstubAllGlobals();
});

describe('buildScheduleCron', () => {
  it('compiles presets through @overdeck/contracts', () => {
    expect(buildScheduleCron('hourly', '21:00', 'mon', '')).toEqual({ ok: true, cron: '0 * * * *' });
    expect(buildScheduleCron('daily', '21:00', 'mon', '')).toEqual({ ok: true, cron: '0 21 * * *' });
    expect(buildScheduleCron('weekly', '09:00', 'mon', '')).toEqual({ ok: true, cron: '0 9 * * 1' });
  });

  it('trims a custom cron and rejects an empty one', () => {
    expect(buildScheduleCron('cron', '21:00', 'mon', '  */5 * * * *  ')).toEqual({ ok: true, cron: '*/5 * * * *' });
    expect(buildScheduleCron('cron', '21:00', 'mon', '   ')).toEqual({ ok: false, error: 'Cron expression is required' });
  });

  it('surfaces a preset validation error', () => {
    expect(buildScheduleCron('daily', '24:00', 'mon', '')).toEqual({
      ok: false,
      error: 'Invalid time "24:00": expected HH:MM (24-hour)',
    });
  });
});

describe('ScheduleMenuItem', () => {
  it('renders "Schedule…" and opens the dialog store for a local conversation', () => {
    const onClose = vi.fn();
    render(<ScheduleMenuItem conversation={{ name: 'conv-a', origin: 'local' }} onClose={onClose} />);
    fireEvent.click(screen.getByText('Schedule…'));
    expect(onClose).toHaveBeenCalled();
    expect(useScheduleDialogStore.getState().conversationName).toBe('conv-a');
  });

  it('renders nothing for a vault or linked conversation', () => {
    const { container: vaultContainer } = render(<ScheduleMenuItem conversation={{ name: 'conv-a', origin: 'vault' }} onClose={vi.fn()} />);
    expect(vaultContainer).toBeEmptyDOMElement();
    const { container: linkedContainer } = render(<ScheduleMenuItem conversation={{ name: 'conv-a', origin: 'linked' }} onClose={vi.fn()} />);
    expect(linkedContainer).toBeEmptyDOMElement();
  });
});

describe('ConversationScheduleDialog (PAN-4657)', () => {
  it('creates a daily schedule defaulting Time zone to the browser zone', async () => {
    renderHostWith({ schedules: [] });
    act(() => openScheduleDialog('conv-a'));
    await screen.findByRole('dialog', { name: 'Schedules' });

    expect(screen.getByLabelText('Time zone')).toHaveValue(BROWSER_ZONE);
    fireEvent.change(screen.getByLabelText('Schedule prompt'), { target: { value: 'Summarize the day' } });
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'daily' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '21:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(BASE, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ prompt: 'Summarize the day', cron: '0 21 * * *', timeZone: BROWSER_ZONE }),
    })));
  });

  it('creates a schedule with a typed time zone', async () => {
    renderHostWith({ schedules: [] });
    act(() => openScheduleDialog('conv-a'));
    await screen.findByRole('dialog', { name: 'Schedules' });

    fireEvent.change(screen.getByLabelText('Schedule prompt'), { target: { value: 'Summarize the day' } });
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'daily' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '21:00' } });
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'America/New_York' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(BASE, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ prompt: 'Summarize the day', cron: '0 21 * * *', timeZone: 'America/New_York' }),
    })));
  });

  it('pauses, resumes, and deletes an existing schedule', async () => {
    // Stateful mock: PATCH/DELETE mutate `view` so the refetch after each
    // write reflects it, instead of racing a manually-swapped fixture.
    view = { schedules: [schedule(3)] };
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') return Response.json(view);
      if (init.method === 'PATCH') {
        const patch = JSON.parse(init.body as string) as { enabled: boolean };
        view = { schedules: (view.schedules as Array<{ id: number }>).map((s) => (s.id === 3 ? { ...s, ...patch } : s)) };
        return Response.json({ ok: true });
      }
      if (init.method === 'DELETE') {
        view = { schedules: (view.schedules as Array<{ id: number }>).filter((s) => s.id !== 3) };
        return Response.json({ removed: true });
      }
      return Response.json({ ok: true });
    });
    renderHost();
    act(() => openScheduleDialog('conv-a'));
    await screen.findByRole('list', { name: 'Schedules' });

    fireEvent.click(screen.getByRole('button', { name: 'Pause schedule 3' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${BASE}/3`, expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ enabled: false }),
    })));
    await screen.findByRole('button', { name: 'Resume schedule 3' });

    fireEvent.click(screen.getByRole('button', { name: 'Resume schedule 3' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${BASE}/3`, expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ enabled: true }),
    })));
    await screen.findByRole('button', { name: 'Pause schedule 3' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete schedule 3' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${BASE}/3`, { method: 'DELETE' }));
    await waitFor(() => expect(screen.getByText('No schedules yet.')).toBeInTheDocument());
  });

  it('shows the cron, time zone, next run and last outcome on each row', async () => {
    renderHostWith({
      schedules: [
        schedule(3),
        schedule(4, { enabled: false, lastRunStatus: 'failed', lastRunError: 'Waiting: permission answer needed' }),
      ],
    });
    act(() => openScheduleDialog('conv-a'));
    const list = await screen.findByRole('list', { name: 'Schedules' });

    expect(list).toHaveTextContent('0 21 * * * · UTC');
    expect(list).toHaveTextContent('last failed');
    const failedLine = screen.getByText('last failed');
    expect(failedLine).toHaveAttribute('title', 'Waiting: permission answer needed');
    expect(list).toHaveTextContent('paused');
  });

  it('pre-fills Cron expression and Time zone on Edit, saves with PATCH keeping the stored zone, and shows a 400 error as an alert', async () => {
    renderHostWith({ schedules: [schedule(3, { prompt: 'Evening wrap-up', cron: '0 20 * * *', timeZone: 'UTC' })] });
    act(() => openScheduleDialog('conv-a'));
    await screen.findByRole('list', { name: 'Schedules' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit schedule 3' }));
    expect(screen.getByLabelText('Repeat')).toHaveValue('cron');
    expect(screen.getByLabelText('Cron expression')).toHaveValue('0 20 * * *');
    expect(screen.getByLabelText('Schedule prompt')).toHaveValue('Evening wrap-up');
    expect(screen.getByLabelText('Time zone')).toHaveValue('UTC');

    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return Response.json({ error: 'Schedules must be at least 15 minutes apart' }, { status: 400 });
      return Response.json(view);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${BASE}/3`, expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ prompt: 'Evening wrap-up', cron: '0 20 * * *', timeZone: 'UTC' }),
    })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Schedules must be at least 15 minutes apart');
  });

  it('closes on Escape', async () => {
    renderHostWith({ schedules: [] });
    act(() => openScheduleDialog('conv-a'));
    await screen.findByRole('dialog', { name: 'Schedules' });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Schedules' })).not.toBeInTheDocument());
  });
});
