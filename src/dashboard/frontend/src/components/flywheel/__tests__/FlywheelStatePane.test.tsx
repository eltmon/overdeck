import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FlywheelStatePane } from '../FlywheelStatePane';
import { renderWithQuery, stubFetch } from './fixtures';

describe('FlywheelStatePane (PAN-3964 FR-10)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders .pan/flywheel/state.md as markdown', async () => {
    stubFetch((url) => (url === '/api/flywheel/state'
      ? Response.json({ exists: true, path: '.pan/flywheel/state.md', content: '# Substrate fixes\n\n- **PAN-3960** merge door wedge', lastModified: '2026-09-23T09:00:00.000Z' })
      : undefined));
    renderWithQuery(<FlywheelStatePane />);
    expect(await screen.findByRole('heading', { name: 'Substrate fixes' })).toBeInTheDocument();
    expect(screen.getByText('PAN-3960').tagName).toBe('STRONG');
    expect(screen.getByText('.pan/flywheel/state.md')).toBeInTheDocument();
  });

  it('names .pan/flywheel/state.md in the empty state', async () => {
    stubFetch((url) => (url === '/api/flywheel/state'
      ? Response.json({ exists: false, path: '.pan/flywheel/state.md', content: null, lastModified: null })
      : undefined));
    renderWithQuery(<FlywheelStatePane />);
    expect(await screen.findByText('No flywheel state yet.')).toBeInTheDocument();
    expect(screen.getByText('.pan/flywheel/state.md')).toBeInTheDocument();
  });

  it('shows a read failure', async () => {
    stubFetch((url) => (url === '/api/flywheel/state' ? new Response('{}', { status: 500 }) : undefined));
    renderWithQuery(<FlywheelStatePane />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load flywheel state');
  });
});
