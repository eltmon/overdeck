import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlanSetupScreen } from './PlanSetupScreen';

describe('PlanSetupScreen semantic styling', () => {
  it('uses the planning signal for the hero, active step, and progress bar', () => {
    const { container } = render(
      <PlanSetupScreen
        issueIdentifier="PAN-3941"
        issueTitle="Unify dashboard menus"
        steps={[{
          step: 1,
          total: 5,
          label: 'Creating workspace',
          detail: 'Preparing files',
          status: 'active',
        }]}
      />,
    );

    expect(screen.getByText('Setting up planning session')).toBeInTheDocument();
    expect(container.querySelector('[class~="border-signal-review/32"]')).not.toBeNull();
    expect(container.querySelector('.bg-signal-review')).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/purple-|blue-/);
  });
});
