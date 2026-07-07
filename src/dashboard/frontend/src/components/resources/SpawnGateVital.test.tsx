import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SpawnGateVital } from './SpawnGateVital';

describe('SpawnGateVital', () => {
  it('renders SOFT state with amber border and reason', () => {
    render(
      <SpawnGateVital
        spawnGate={{
          state: 'SOFT',
          reason: 'Work agent count is high.',
          pressure: 67,
          warnings: [{ severity: 'warning', code: 'agent_capacity', message: 'Work agent count is high.' }],
        }}
      />,
    );

    expect(screen.getByLabelText('Spawn gate')).toHaveClass('gate-soft');
    expect(screen.getByText('SOFT')).toBeTruthy();
    expect(screen.getByText('Work agent count is high.')).toBeTruthy();
  });
});
