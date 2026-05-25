import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useDashboardStore } from '../../lib/store';
import { HomePage } from '../HomePage';

function setBootstrapped(bootstrapComplete: boolean): void {
  useDashboardStore.setState({ bootstrapComplete });
}

describe('HomePage', () => {
  beforeEach(() => {
    setBootstrapped(false);
  });

  afterEach(() => {
    setBootstrapped(false);
  });

  it('renders the loading state before the dashboard snapshot arrives', () => {
    render(<HomePage />);

    expect(screen.getByTestId('home-loading')).toHaveTextContent('Loading Home snapshot…');
  });

  it('renders empty shell sections after bootstrap without PAN-1052 data', () => {
    setBootstrapped(true);

    render(<HomePage />);

    expect(screen.getByTestId('home-page')).toHaveTextContent('Panopticon briefing');
    expect(screen.getByText('System summary')).toBeInTheDocument();
    expect(screen.getByText('Activity feed')).toBeInTheDocument();
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
    expect(screen.getByText('Knowledge registry')).toBeInTheDocument();
    expect(screen.getByText('No observations yet. Activity will appear after memory extraction creates it.')).toBeInTheDocument();
  });
});
