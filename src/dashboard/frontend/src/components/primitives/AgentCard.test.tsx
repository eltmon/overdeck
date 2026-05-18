import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AgentCard from './AgentCard';
import VerbBadge from './VerbBadge';

describe('AgentCard', () => {
  it('renders root with data-component="agent-card"', () => {
    render(<AgentCard name="agent-pan-100" phase="work" />);
    const card = screen.getByText('agent-pan-100').closest('[data-component="agent-card"]');
    expect(card).toBeTruthy();
  });

  it('renders phase dot, name, verb badge, and menu button', () => {
    render(
      <AgentCard
        name="agent-pan-100"
        phase="review"
        verbBadge={<VerbBadge variant="REVIEW RUNNING" />}
      />,
    );

    expect(screen.getByText('agent-pan-100')).toBeTruthy();
    expect(screen.getByText('REVIEW RUNNING')).toBeTruthy();
    expect(screen.getByLabelText('Agent options')).toBeTruthy();
  });

  it('applies stuck border override and renders stuck banner when stuck is true', () => {
    const { container } = render(<AgentCard name="agent-pan-100" phase="work" stuck />);
    const card = container.querySelector('[data-component="agent-card"]');
    expect(card).toHaveAttribute('data-stuck', 'true');
    expect(screen.getByText('Agent is stuck and requires attention')).toBeTruthy();
  });

  it('does not render stuck banner when stuck is false', () => {
    const { container } = render(<AgentCard name="agent-pan-100" phase="work" />);
    expect(container.querySelector('[data-stuck]')).toBeNull();
    expect(screen.queryByText('Agent is stuck and requires attention')).toBeNull();
  });

  it('renders issue panel with project mark, id, and title', () => {
    render(
      <AgentCard
        name="agent-pan-100"
        phase="work"
        issue={{
          projectMarkClassName: 'bg-info',
          id: 'PAN-1148',
          title: 'Dashboard unified redesign',
        }}
      />,
    );

    expect(screen.getByText('PAN-1148')).toBeTruthy();
    expect(screen.getByText(/Dashboard unified redesign/)).toBeTruthy();
  });

  it('renders meta tri-column with labels and values', () => {
    render(
      <AgentCard
        name="agent-pan-100"
        phase="work"
        meta={[
          { label: 'Runtime', value: '2h 14m' },
          { label: 'Cost', value: '$1.24', variant: 'cost' },
          { label: 'Model', value: 'claude-opus' },
        ]}
      />,
    );

    expect(screen.getByText('Runtime')).toBeTruthy();
    expect(screen.getByText('2h 14m')).toBeTruthy();
    expect(screen.getByText('Cost')).toBeTruthy();
    expect(screen.getByText('$1.24')).toBeTruthy();
    expect(screen.getByText('Model')).toBeTruthy();
    expect(screen.getByText('claude-opus')).toBeTruthy();
  });

  it('renders stream excerpt with fade-out gradient', () => {
    const { container } = render(
      <AgentCard
        name="agent-pan-100"
        phase="work"
        streamExcerpt="Running tests...\nAll tests passed."
      />,
    );

    expect(screen.getByText(/Running tests/)).toBeTruthy();
    const excerptWrapper = container.querySelector('pre')?.parentElement;
    expect(excerptWrapper).toBeTruthy();
    const fade = excerptWrapper?.querySelector('span[aria-hidden="true"]');
    expect(fade).toBeTruthy();
    expect(fade).toHaveClass('bg-gradient-to-t', 'from-card', 'to-transparent');
  });

  it('renders footer action links with correct alignment and colors', () => {
    const onPrimary = vi.fn();
    const onDanger = vi.fn();

    render(
      <AgentCard
        name="agent-pan-100"
        phase="work"
        footerActions={[
          { label: 'Open issue', variant: 'primary', onClick: onPrimary },
          { label: 'Stop', variant: 'danger', onClick: onDanger },
        ]}
      />,
    );

    const primary = screen.getByText('Open issue');
    const danger = screen.getByText('Stop');

    expect(primary).toBeTruthy();
    expect(danger).toBeTruthy();

    expect(primary.closest('button')).toHaveClass('ml-auto');
    expect(primary.closest('button')).toHaveClass('text-[var(--info-foreground)]');
    expect(danger.closest('button')).toHaveClass('text-[var(--destructive-foreground)]');
  });

  it('calls onMenuClick when menu button is clicked', () => {
    const onMenuClick = vi.fn();
    render(<AgentCard name="agent-pan-100" phase="work" onMenuClick={onMenuClick} />);

    screen.getByLabelText('Agent options').click();
    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });
});
