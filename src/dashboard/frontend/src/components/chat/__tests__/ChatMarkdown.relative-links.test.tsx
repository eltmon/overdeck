import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// PAN-5337: a document-relative link in a Markdown preview must never reach
// the browser as a plain <a> — it would resolve against /conv/<id> and 404.
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/wsTransport', () => ({ getTransport: () => ({ request: vi.fn(), resolveFilePathExists: vi.fn() }) }));

import { ChatMarkdown } from '../ChatMarkdown';

function renderMarkdown(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

describe('ChatMarkdown relative links (PAN-5337)', () => {
  it('renders a relative link without cwd as inert text', () => {
    renderMarkdown(<ChatMarkdown text="[levels](levels/) [Fort](fort3d.md)" cwd={undefined} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.querySelector('a')).toBeNull();
    expect(screen.getAllByTestId('markdown-inert-link')).toHaveLength(2);
    expect(screen.getByText('levels')).toBeInTheDocument();
    expect(screen.getByText('Fort')).toBeInTheDocument();
  });

  it('keeps /conv/123 as a TranscriptLink', () => {
    renderMarkdown(<ChatMarkdown text="[conv](/conv/123)" cwd={undefined} />);

    expect(screen.getByRole('link', { name: 'conv' })).toHaveAttribute('href', '/conv/123');
  });

  it('keeps https links with target _blank', () => {
    renderMarkdown(<ChatMarkdown text="[web](https://example.com)" cwd={undefined} />);

    expect(screen.getByRole('link', { name: 'web' })).toHaveAttribute('target', '_blank');
  });
});
