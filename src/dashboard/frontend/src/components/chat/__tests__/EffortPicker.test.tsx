import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EffortPicker } from '../EffortPicker';

describe('chat EffortPicker dropdown portal (PAN-4266)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('portals the dropdown to document.body when open', async () => {
    const user = userEvent.setup();
    const { container } = render(<EffortPicker value="high" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /High \(default\)/i }));

    const dropdown = await screen.findByTestId('effort-picker-dropdown');
    expect(dropdown.parentElement).toBe(document.body);
    expect(container).not.toContainElement(dropdown);
  });

  it('selects an option, calls onChange, and closes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EffortPicker value="high" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /High \(default\)/i }));
    await user.click(await screen.findByRole('button', { name: 'Low' }));

    expect(onChange).toHaveBeenCalledWith('low');
    await waitFor(() => expect(screen.queryByTestId('effort-picker-dropdown')).not.toBeInTheDocument());
  });

  it('closes on an outside mousedown but stays open for a mousedown inside the dropdown', async () => {
    const user = userEvent.setup();
    render(<EffortPicker value="high" onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /High \(default\)/i }));
    const dropdown = await screen.findByTestId('effort-picker-dropdown');

    fireEvent.mouseDown(dropdown);
    expect(screen.queryByTestId('effort-picker-dropdown')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByTestId('effort-picker-dropdown')).not.toBeInTheDocument());
  });

  it('renders the unsupported hint with no dropdown when availableLevels is empty', async () => {
    const user = userEvent.setup();
    render(<EffortPicker value="high" onChange={vi.fn()} availableLevels={[]} />);

    expect(screen.getByText('effort n/a for this model')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    // No trigger button renders in this state, so there is nothing to click open.
    await user.click(screen.getByText('effort n/a for this model'));
    expect(screen.queryByTestId('effort-picker-dropdown')).not.toBeInTheDocument();
  });
});
