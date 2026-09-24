/**
 * PAN-3932: the auto-merge indicator is read-only, so its tooltip has to say
 * where the value comes from: the issue's tracker label first.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AutoMergeToggle } from './AutoMergeToggle';

function renderToggle(issues: Array<{ issueId: string; autoMerge: boolean }>, variant: 'segmented' | 'badge') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ issues }) });
  vi.stubGlobal('fetch', fetchImpl);
  render(
    <QueryClientProvider client={client}>
      <AutoMergeToggle issueId="pan-3932" variant={variant} />
    </QueryClientProvider>,
  );
  return fetchImpl;
}

function indicator(variant: 'segmented' | 'badge'): HTMLElement {
  return variant === 'badge'
    ? screen.getByTestId('auto-merge-badge')
    : screen.getByRole('group', { name: 'Auto-merge policy' });
}

describe('AutoMergeToggle tooltip', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const cases = [
    { label: 'auto', issues: [{ issueId: 'PAN-3932', autoMerge: true }], lead: 'Auto-merge' },
    { label: 'hold', issues: [{ issueId: 'PAN-3932', autoMerge: false }], lead: 'Hold for UAT' },
    { label: 'not routed', issues: [], lead: 'Not routed yet' },
  ] as const;

  for (const variant of ['segmented', 'badge'] as const) {
    for (const { label, issues, lead } of cases) {
      it(`${variant} / ${label}: says it is read-only and names the tracker label tier`, async () => {
        const fetchImpl = renderToggle([...issues], variant);
        await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/api/merge-train/auto-merge'));
        await waitFor(() => expect(indicator(variant).getAttribute('title')).toMatch(new RegExp(`^${lead}`)));

        const title = indicator(variant).getAttribute('title') ?? '';
        expect(title).toContain('Read-only');
        expect(title).toContain('auto-merge or hold-for-uat tracker label');
        expect(title).not.toContain('Set by the project default.');
        // Precedence order: label, then project default, then global.
        expect(title.indexOf('tracker label')).toBeLessThan(title.indexOf('project\'s auto-merge default'));
        expect(title.indexOf('project\'s auto-merge default')).toBeLessThan(title.indexOf('require-UAT-before-merge'));
      });
    }
  }
});
