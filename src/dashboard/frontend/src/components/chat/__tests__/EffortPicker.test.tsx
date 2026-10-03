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

describe('chat EffortPicker chip label (PAN-4255)', () => {
  it('renders the level and source for a launch value', () => {
    render(<EffortPicker value="high" onChange={vi.fn()} chip={{ level: 'high', source: 'default', observed: false }} />);

    const chip = screen.getByTestId('effort-chip');
    expect(chip).toHaveTextContent('High · default');
    expect(chip).toHaveAttribute('data-observed', 'false');
    expect(screen.queryByText(/Effort\s+unverified/)).toBeNull();
  });

  it('renders a native-terminal change', () => {
    render(<EffortPicker value="high" onChange={vi.fn()} chip={{ level: 'low', source: 'terminal', observed: true }} />);

    const chip = screen.getByTestId('effort-chip');
    expect(chip).toHaveTextContent('Low · terminal');
    expect(chip).toHaveAttribute('data-observed', 'true');
    expect(screen.queryByText(/Effort\s+unverified/)).toBeNull();
  });

  it('renders an observed level with no known source', () => {
    render(<EffortPicker value="high" onChange={vi.fn()} chip={{ level: 'xhigh', source: null, observed: true }} />);

    expect(screen.getByTestId('effort-chip')).toHaveTextContent(/^Extra High$/);
  });

  it('renders Applying… while a change is pending', () => {
    render(<EffortPicker value="high" onChange={vi.fn()} pending chip={{ level: 'high', source: 'explicit', observed: true }} />);

    expect(screen.getByTestId('effort-chip')).toHaveTextContent('Applying…');
    expect(screen.queryByText(/Effort\s+unverified/)).toBeNull();
  });

  it('falls back to the draft label without a chip', () => {
    render(<EffortPicker value="high" onChange={vi.fn()} />);

    const chip = screen.getByTestId('effort-chip');
    expect(chip).toHaveTextContent('High (default)');
    expect(chip).not.toHaveAttribute('data-observed');
    expect(screen.queryByText(/Effort\s+unverified/)).toBeNull();
  });
});
