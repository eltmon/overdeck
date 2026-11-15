import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { ChatMarkdown, isRelativeMarkdownHref } from '../ChatMarkdown';

function renderMarkdown(node: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

describe('ChatMarkdown relative links (PAN-5338 D-11)', () => {
  it('renders a relative href as plain text when plainRelativeLinks is set', () => {
    renderMarkdown(<ChatMarkdown text="See [fort3d](fort3d.md) for details." cwd={undefined} plainRelativeLinks />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('fort3d')).toBeInTheDocument();
  });

  it('still renders an external https href as an anchor when plainRelativeLinks is set', () => {
    renderMarkdown(<ChatMarkdown text="Visit [x](https://example.com)." cwd={undefined} plainRelativeLinks />);

    const link = screen.getByRole('link', { name: 'x' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('still renders a same-page hash href as an anchor when plainRelativeLinks is set', () => {
    renderMarkdown(<ChatMarkdown text="Jump to [h](#top)." cwd={undefined} plainRelativeLinks />);

    expect(screen.getByRole('link', { name: 'h' })).toHaveAttribute('href', '#top');
  });

  it('renders a relative href as a normal anchor when plainRelativeLinks is not set (default unchanged)', () => {
    renderMarkdown(<ChatMarkdown text="See [fort3d](fort3d.md) for details." cwd={undefined} />);

    expect(screen.getByRole('link', { name: 'fort3d' })).toHaveAttribute('href', 'fort3d.md');
  });
});

describe('isRelativeMarkdownHref', () => {
  it.each([
    ['fort3d.md', true],
    ['../x.md', true],
    ['docs/a.md', true],
    ['#top', false],
    ['/abs/path', false],
    ['https://example.com', false],
    ['http://example.com', false],
    ['mailto:a@b.com', false],
    ['', false],
    [undefined, false],
  ])('isRelativeMarkdownHref(%s) === %s', (href, expected) => {
    expect(isRelativeMarkdownHref(href)).toBe(expected);
  });
});
