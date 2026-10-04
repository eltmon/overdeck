import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DiffCompareBar } from '../DiffCompareBar';

const REFS = {
  repoRoot: '/repo',
  head: { branch: 'main', sha: 'b'.repeat(40) },
  branches: [{ name: 'main', sha: 'b'.repeat(40), remote: false }],
  tags: [{ name: 'v1', sha: 'a'.repeat(40) }],
  commits: [
    { sha: 'b'.repeat(40), shortSha: 'bbbbbbb', subject: 'Second commit', date: '2020-01-02T00:00:00Z' },
    { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'First commit', date: '2020-01-01T00:00:00Z' },
  ],
};

function renderBar(props: Partial<React.ComponentProps<typeof DiffCompareBar>> = {}) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(REFS), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const onApply = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <DiffCompareBar repoPath="/repo" base="" head="" mode="two-dot" onApply={onApply} {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, onApply, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DiffCompareBar (PAN-4503)', () => {
  it('lists branch, tag and commit suggestions from the refs route', async () => {
    const { container, fetchMock } = renderBar();
    await waitFor(() => expect(container.querySelectorAll('datalist option')).toHaveLength(4));
    const values = [...container.querySelectorAll('datalist option')].map((option) => option.getAttribute('value'));
    expect(values).toEqual(['main', 'v1', 'bbbbbbb', 'aaaaaaa']);
    expect(fetchMock).toHaveBeenCalledWith('/api/diffs/refs?repo=%2Frepo');
  });

  it('applies trimmed refs and the selected mode', async () => {
    const { onApply } = renderBar();
    fireEvent.change(screen.getByLabelText('Compare base ref'), { target: { value: ' v1 ' } });
    fireEvent.change(screen.getByLabelText('Compare head ref'), { target: { value: 'main' } });
    fireEvent.click(screen.getByLabelText('Three-dot compare'));
    expect(screen.getByLabelText('Three-dot compare').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(onApply).toHaveBeenCalledWith({ base: 'v1', head: 'main', mode: 'three-dot' });
  });

  it('applies on Enter in a ref input', () => {
    const { onApply } = renderBar({ base: 'v1', head: 'main' });
    fireEvent.keyDown(screen.getByLabelText('Compare head ref'), { key: 'Enter' });
    expect(onApply).toHaveBeenCalledWith({ base: 'v1', head: 'main', mode: 'two-dot' });
  });

  it('starts head at HEAD and disables Compare while base is empty', () => {
    const { onApply } = renderBar();
    expect((screen.getByLabelText('Compare head ref') as HTMLInputElement).value).toBe('HEAD');
    const button = screen.getByRole('button', { name: 'Compare' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('shows the compare error', () => {
    renderBar({ error: 'Unknown ref' });
    expect(screen.getByText('Unknown ref')).toBeTruthy();
  });

  it('shows the refs route error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'REPO_NOT_ALLOWED', error: 'repo is outside' }), { status: 400 })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DiffCompareBar repoPath="/repo" base="" head="" mode="two-dot" onApply={() => {}} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('repo is outside')).toBeTruthy();
  });
});
