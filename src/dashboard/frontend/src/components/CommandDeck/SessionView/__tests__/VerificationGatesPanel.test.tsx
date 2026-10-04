import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VerificationGatesPanel } from '../VerificationGatesPanel';

function renderPanel(outcome: 'passed' | 'failed' | 'skipped') {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    issueId: 'PAN-4543',
    artifact: {
      ranAt: '2026-10-04T06:00:00.000Z',
      outcome,
      gates: [{ name: 'lint', passed: outcome !== 'failed', required: true, durationMs: 1000 }],
    },
  })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VerificationGatesPanel issueId="PAN-4543" />
    </QueryClientProvider>,
  );
}

describe('VerificationGatesPanel heading (PAN-4543)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a skipped run in the muted color, not as a failure', async () => {
    renderPanel('skipped');
    const heading = await screen.findByText('Quality gates skipped');
    expect(heading.style.color).toBe('var(--muted-foreground)');
  });

  it('still renders a failed run in the destructive color', async () => {
    renderPanel('failed');
    const heading = await screen.findByText('Quality gates failed');
    expect(heading.style.color).toBe('var(--destructive)');
  });
});
