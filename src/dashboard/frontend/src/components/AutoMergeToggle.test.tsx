/**
 * AutoMergeToggle (PAN-3932, PAN-4753 WI-10).
 *
 * Read-only (`writable={false}`, or after the policy route answers 404/501):
 * the tooltip says where the value comes from, the issue's tracker label
 * first. Editable: Auto/Hold write `POST /api/merge-train/policy/:issueId`,
 * the pressed label clears to default, and an error reverts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AutoMergeToggle, nextPolicyWrite, type AutoMergeToggleProps } from './AutoMergeToggle';

interface PolicyResponse { status: number; body: unknown }

function renderToggle(
  issues: Array<{ issueId: string; autoMerge: boolean }>,
  props: Partial<AutoMergeToggleProps> = {},
  policyResponse: PolicyResponse = { status: 200, body: { issueId: 'PAN-3932', policy: 'hold', effectivePolicy: 'hold', route: 'batch' } },
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The policy map reflects a successful label write, as the server's does.
  let current = issues;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/dashboard/session')) {
      return { ok: true, status: 200, json: async () => ({ csrfToken: 'test-csrf-token' }) } as Response;
    }
    if (url.includes('/api/merge-train/policy/') && init?.method === 'POST') {
      const ok = policyResponse.status < 400;
      const policy = (JSON.parse(String(init.body)) as { policy: string }).policy;
      if (ok && policy !== 'default') current = [{ issueId: 'PAN-3932', autoMerge: policy === 'auto' }];
      return { ok, status: policyResponse.status, json: async () => policyResponse.body } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ issues: current }) } as Response;
  });
  vi.stubGlobal('fetch', fetchImpl);
  render(
    <QueryClientProvider client={client}>
      <AutoMergeToggle issueId="pan-3932" writable {...props} />
    </QueryClientProvider>,
  );
  return fetchImpl;
}

function policyPosts(fetchImpl: ReturnType<typeof vi.fn>): unknown[] {
  return (fetchImpl.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>)
    .filter(([url, init]) => String(url).includes('/api/merge-train/policy/PAN-3932') && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)));
}

function indicator(variant: 'segmented' | 'badge'): HTMLElement {
  return variant === 'badge'
    ? screen.getByTestId('auto-merge-badge')
    : screen.getByRole('group', { name: 'Auto-merge policy' });
}

describe('AutoMergeToggle read-only tooltip', () => {
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
        const fetchImpl = renderToggle([...issues], { variant, writable: false });
        await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/api/merge-train/auto-merge'));
        await waitFor(() => expect(indicator(variant).getAttribute('title')).toMatch(new RegExp(`^${lead}`)));

        const title = indicator(variant).getAttribute('title') ?? '';
        expect(title).toContain('Read-only');
        expect(title).toContain('Set the auto-merge / hold-for-uat label in the tracker');
        expect(title).toContain('auto-merge or hold-for-uat tracker label');
        expect(title.indexOf('tracker label')).toBeLessThan(title.indexOf('project\'s auto-merge default'));
        expect(title.indexOf('project\'s auto-merge default')).toBeLessThan(title.indexOf('require-UAT-before-merge'));
        expect(screen.queryByRole('button')).toBeNull();
      });
    }
  }
});

describe('AutoMergeToggle editable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // PAN-5321: the WI-8 policy route shipped, so every render site is editable unless it opts out.
  it('is editable by default', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ issues: [{ issueId: 'PAN-3932', autoMerge: true }] }) }) as Response));
    render(
      <QueryClientProvider client={client}>
        <AutoMergeToggle issueId="pan-3932" />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('button', { name: /Hold/ })).toBeInTheDocument();
  });

  it('clicking Hold writes the hold label and presses Hold', async () => {
    const fetchImpl = renderToggle([{ issueId: 'PAN-3932', autoMerge: true }], { policy: null });
    const hold = await screen.findByRole('button', { name: /Hold/ });
    await waitFor(() => expect(screen.getByRole('button', { name: /Auto/ }).getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(hold);
    await waitFor(() => expect(policyPosts(fetchImpl)).toEqual([{ policy: 'hold' }]));
    await waitFor(() => expect(screen.getByRole('button', { name: /Hold/ }).getAttribute('aria-pressed')).toBe('true'));
  });

  it('clicking the pressed button that is the label value clears it to default', async () => {
    const fetchImpl = renderToggle([{ issueId: 'PAN-3932', autoMerge: true }], { policy: 'auto' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Auto/ }).getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: /Auto/ }));
    await waitFor(() => expect(policyPosts(fetchImpl)).toEqual([{ policy: 'default' }]));
  });

  it('marks the pressed button "default" when no label is set', async () => {
    renderToggle([{ issueId: 'PAN-3932', autoMerge: false }], { policy: null });
    await waitFor(() => expect(screen.getByRole('button', { name: /Hold/ }).textContent).toContain('default'));
    expect(screen.getByRole('button', { name: /Auto/ }).textContent).not.toContain('default');
  });

  it.each([404, 501])('a %s from the policy route falls back to the read-only indicator', async (status) => {
    renderToggle([{ issueId: 'PAN-3932', autoMerge: true }], { policy: null }, { status, body: { error: 'not supported' } });
    fireEvent.click(await screen.findByRole('button', { name: /Hold/ }));
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
    expect(indicator('segmented').getAttribute('title')).toContain('Set the auto-merge / hold-for-uat label in the tracker');
    // Reverted: Auto is still the pressed value.
    const auto = Array.from(indicator('segmented').querySelectorAll('[aria-pressed]')).find((el) => el.textContent?.includes('Auto'));
    expect(auto?.getAttribute('aria-pressed')).toBe('true');
  });

  it('any other error reverts and shows the server message', async () => {
    renderToggle([{ issueId: 'PAN-3932', autoMerge: true }], { policy: null }, { status: 502, body: { error: 'GitHub refused the label write' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Auto/ }).getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: /Hold/ }));
    await waitFor(() => expect(indicator('segmented').getAttribute('title')).toContain('GitHub refused the label write'));
    expect(screen.getByRole('button', { name: /Auto/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('the badge variant flips Auto to Hold', async () => {
    const fetchImpl = renderToggle([{ issueId: 'PAN-3932', autoMerge: true }], { variant: 'badge' });
    await waitFor(() => expect(screen.getByTestId('auto-merge-badge').textContent).toContain('auto'));
    fireEvent.click(screen.getByTestId('auto-merge-badge'));
    await waitFor(() => expect(policyPosts(fetchImpl)).toEqual([{ policy: 'hold' }]));
  });
});

describe('nextPolicyWrite', () => {
  it('the label value clears; any other click sets that value', () => {
    expect(nextPolicyWrite({ clicked: 'auto', label: 'auto', pressed: true })).toBe('default');
    expect(nextPolicyWrite({ clicked: 'auto', label: null, pressed: true })).toBe('auto');
    expect(nextPolicyWrite({ clicked: 'hold', label: 'auto', pressed: false })).toBe('hold');
    expect(nextPolicyWrite({ clicked: 'hold', label: undefined, pressed: true })).toBe('default');
    expect(nextPolicyWrite({ clicked: 'hold', label: undefined, pressed: false })).toBe('hold');
  });
});
