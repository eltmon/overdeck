import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from './Header';

vi.mock('./CloisterStatusBar', () => ({
  CloisterStatusBar: () => <div data-testid="cloister-status-bar" />,
}));

vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Panopticon title', () => {
    render(<Header activeTab="kanban" onTabChange={vi.fn()} onSearchOpen={vi.fn()} />);
    expect(screen.getByText('Panopticon')).toBeInTheDocument();
  });

  it('renders core nav items', () => {
    render(<Header activeTab="kanban" onTabChange={vi.fn()} onSearchOpen={vi.fn()} />);
    expect(screen.getByText('Board')).toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders skills and health nav items', () => {
    render(<Header activeTab="kanban" onTabChange={vi.fn()} onSearchOpen={vi.fn()} />);
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Health')).toBeInTheDocument();
  });

  it('calls onTabChange when a nav item is clicked', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<Header activeTab="mission-control" onTabChange={onTabChange} onSearchOpen={vi.fn()} />);
    await user.click(screen.getByText('Board'));
    expect(onTabChange).toHaveBeenCalledWith('kanban');
  });

  it('calls onTabChange with mission-control when logo is clicked', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<Header activeTab="kanban" onTabChange={onTabChange} onSearchOpen={vi.fn()} />);
    await user.click(screen.getByTitle('Go to Mission Control'));
    expect(onTabChange).toHaveBeenCalledWith('mission-control');
  });

  it('calls onSearchOpen when search button is clicked', async () => {
    const user = userEvent.setup();
    const onSearchOpen = vi.fn();
    render(<Header activeTab="kanban" onTabChange={vi.fn()} onSearchOpen={onSearchOpen} />);
    await user.click(screen.getByTitle('Search (press /)'));
    expect(onSearchOpen).toHaveBeenCalled();
  });

  it('highlights the active tab with primary color', () => {
    render(<Header activeTab="kanban" onTabChange={vi.fn()} onSearchOpen={vi.fn()} />);
    const boardButton = screen.getByText('Board').closest('button');
    expect(boardButton).toHaveStyle({ backgroundColor: '#2769ec' });
  });

  it('renders the CloisterStatusBar', () => {
    render(<Header activeTab="kanban" onTabChange={vi.fn()} onSearchOpen={vi.fn()} />);
    expect(screen.getByTestId('cloister-status-bar')).toBeInTheDocument();
  });
});
