import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AgentCard from './AgentCard';

describe('AgentCard', () => {
  it('renders ship role with --signal-review accent', () => {
    render(
      <AgentCard
        id="agent-ship-1"
        name="Ship Agent"
        role="ship"
        meta={[
          { label: 'Cost', value: '$0.00' },
          { label: 'Tokens', value: '0' },
          { label: 'Runtime', value: '0m' },
        ]}
        verbBadge={{ variant: 'SHIP RUNNING' }}
      />,
    );

    const card = screen.getByText('Ship Agent').closest('[data-component="agent-card"]') as HTMLElement;
    expect(card).toHaveStyle('--agent-card-accent: var(--signal-review)');
  });

  it('preserves all role accents without regression', () => {
    const roles = [
      { role: 'plan' as const, accent: 'var(--signal-review)' },
      { role: 'work' as const, accent: 'var(--info)' },
      { role: 'review' as const, accent: 'var(--warning)' },
      { role: 'test' as const, accent: 'var(--success)' },
      { role: 'ship' as const, accent: 'var(--signal-review)' },
      { role: 'flywheel' as const, accent: 'var(--primary)' },
    ];

    for (const { role, accent } of roles) {
      const { unmount } = render(
        <AgentCard
          id={`agent-${role}`}
          name={`${role} Agent`}
          role={role}
          meta={[
            { label: 'Cost', value: '$0.00' },
            { label: 'Tokens', value: '0' },
            { label: 'Runtime', value: '0m' },
          ]}
          verbBadge={{ variant: 'WORK RUNNING' }}
        />,
      );

      const card = screen.getByText(`${role} Agent`).closest('[data-component="agent-card"]') as HTMLElement;
      expect(card).toHaveStyle(`--agent-card-accent: ${accent}`);
      unmount();
    }
  });
});
