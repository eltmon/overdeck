/** PAN-4651 WI-27 (D-4651-20): the Compare settings dialog. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CompareSettingsDialog } from '../CompareSettingsDialog';

function renderWith(answer: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => answer })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><CompareSettingsDialog machine="env-desk" label="desk" onClose={() => undefined} /></QueryClientProvider>);
}

const DIFFERENCES = [
  { key: 'api_keys.openai', here: { secret: true, set: true }, there: { secret: true, set: false }, copyLine: null },
  { key: 'resources.quality_gate_slots', here: { value: '2' }, there: { value: '4' }, copyLine: 'pan admin config set resources.quality_gate_slots 2' },
];

afterEach(() => vi.unstubAllGlobals());

describe('CompareSettingsDialog (PAN-4651 WI-27)', () => {
  it('ac27: lists differences with secrets as set/not set and one copy button per copy line', async () => {
    renderWith({ machine: { environmentId: 'env-desk', label: 'desk' }, dashboardUrl: null, differences: DIFFERENCES });
    const secret = await screen.findByTestId('settings-diff-api_keys.openai');
    expect(within(secret).getByText('set')).toBeTruthy();
    expect(within(secret).getByText('not set')).toBeTruthy();
    expect(within(secret).queryByRole('button')).toBeNull();
    const slots = screen.getByTestId('settings-diff-resources.quality_gate_slots');
    expect(within(slots).getByRole('button', { name: 'Copy pan admin config set resources.quality_gate_slots 2' })).toBeTruthy();
    expect(screen.queryByText("Open desk's dashboard")).toBeNull();
  });

  it('ac27: renders Open desk\'s dashboard only with a tailnet route', async () => {
    renderWith({ machine: { environmentId: 'env-desk', label: 'desk' }, dashboardUrl: 'https://desk.tail1234.ts.net/', differences: [] });
    const link = await screen.findByText("Open desk's dashboard");
    expect(link.getAttribute('href')).toBe('https://desk.tail1234.ts.net/');
    expect(screen.getByText('No differences.')).toBeTruthy();
  });
});
