/** PAN-4655 WI-7: the Settings → Conversations idle auto-settle row. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoSettleIdleRow } from '../AutoSettleIdleRow';

vi.mock('../../../../lib/wsTransport', () => ({
  ensureDashboardSession: vi.fn().mockResolvedValue(undefined),
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'Content-Type': 'application/json' }),
}));

const ENDPOINT = '/api/conversations/triage/auto-settle';

function renderRow() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AutoSettleIdleRow />
    </QueryClientProvider>,
  );
}

function mockFetch(opts: { putStatus?: number; putBody?: unknown } = {}) {
  const puts: unknown[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url === ENDPOINT && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { idleDays: number };
      puts.push(body);
      return new Response(JSON.stringify(opts.putBody ?? body), { status: opts.putStatus ?? 200 });
    }
    if (url === ENDPOINT) return new Response(JSON.stringify({ idleDays: 3 }), { status: 200 });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return puts;
}

async function loadedInput(): Promise<HTMLInputElement> {
  const input = await screen.findByTestId('auto-settle-idle-days-input') as HTMLInputElement;
  await waitFor(() => expect(input.value).toBe('3'));
  return input;
}

describe('AutoSettleIdleRow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the stored value', async () => {
    mockFetch();
    renderRow();
    expect(screen.getByText('Auto-settle idle conversations')).toBeTruthy();
    await loadedInput();
  });

  it('saves a changed value on blur', async () => {
    const puts = mockFetch();
    renderRow();
    const input = await loadedInput();

    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.blur(input);

    await waitFor(() => expect(puts).toEqual([{ idleDays: 5 }]));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each(['-1', '400'])('shows an alert for %s and sends nothing', async (value) => {
    const puts = mockFetch();
    renderRow();
    const input = await loadedInput();

    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);

    expect((await screen.findByRole('alert')).textContent).toBe('Enter a whole number from 0 to 365');
    expect(puts).toEqual([]);
  });

  it('shows the server error when the save is rejected', async () => {
    mockFetch({ putStatus: 400, putBody: { error: 'idleDays must be a whole number from 0 to 365' } });
    renderRow();
    const input = await loadedInput();

    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect((await screen.findByRole('alert')).textContent).toBe('idleDays must be a whole number from 0 to 365');
  });
});
