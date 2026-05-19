import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';

function renderPalette() {
  const onClose = vi.fn();
  const onNavigate = vi.fn();

  render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />);

  return { onClose, onNavigate };
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows /pan-flywheel action when searching for flywheel and navigates to the Flywheel page', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderPalette();

    await user.type(screen.getByPlaceholderText('Search actions, workspaces, agents…'), 'flywheel');

    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getByText('Run flywheel')).toBeInTheDocument();
    expect(screen.getByText('Start the autonomous pipeline run on all In Progress / In Review issues')).toBeInTheDocument();

    await user.click(screen.getByText('Run flywheel'));

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('flywheel'));
  });

  it('finds /pan-flywheel action via all-up compatibility keyword', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByPlaceholderText('Search actions, workspaces, agents…'), 'all-up');

    expect(screen.getByText('Run flywheel')).toBeInTheDocument();
  });
});
