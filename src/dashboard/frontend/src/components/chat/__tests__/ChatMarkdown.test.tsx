import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChatMarkdown } from '../ChatMarkdown';

describe('ChatMarkdown file links', () => {
  it('renders bare assistant file paths as MarkdownFileLink chips when cwd is provided', () => {
    render(<ChatMarkdown text="Open package.json:1 or /home/eltmon/project/src/App.tsx:42:5." cwd="/home/eltmon/project" />);

    expect(screen.getByRole('link', { name: /project\/package\.json · L1/ })).toHaveClass('chat-markdown-file-link');
    expect(screen.getByRole('link', { name: /project\/src\/App\.tsx · L42:C5/ })).toHaveClass('chat-markdown-file-link');
  });

  it('keeps bare assistant file paths as text when cwd is unavailable', () => {
    render(<ChatMarkdown text="Open /home/eltmon/project/src/App.tsx:42:5." cwd={undefined} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Open /home/eltmon/project/src/App.tsx:42:5.')).toBeInTheDocument();
  });

  it('renders file hrefs as MarkdownFileLink chips when cwd is provided', () => {
    render(<ChatMarkdown text="Open [package.json:1](package.json:1)." cwd="/home/eltmon/project" />);

    const link = screen.getByRole('link', { name: /project\/package\.json · L1/ });
    expect(link).toHaveClass('chat-markdown-file-link');
    expect(link).toHaveAttribute('href', '/home/eltmon/project/package.json:1');
  });

  it('keeps file-like hrefs as normal markdown links when cwd is unavailable', () => {
    render(<ChatMarkdown text="Open [package.json:1](package.json:1)." cwd={undefined} />);

    const link = screen.getByRole('link', { name: 'package.json:1' });
    expect(link).not.toHaveClass('chat-markdown-file-link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('keeps external links safe and blocks scriptable hrefs', () => {
    const { rerender } = render(<ChatMarkdown text="Visit [site](https://example.com)." cwd="/tmp/project" />);

    const external = screen.getByRole('link', { name: 'site' });
    expect(external).toHaveAttribute('href', 'https://example.com');
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');

    rerender(<ChatMarkdown text="Bad [link](javascript:alert(1))." cwd="/tmp/project" />);
    expect(screen.getByText('link').closest('a')).not.toHaveAttribute('href');
  });
});
