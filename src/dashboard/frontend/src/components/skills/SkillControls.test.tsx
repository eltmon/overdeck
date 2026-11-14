/**
 * PAN-5245 WI-2: levelRowState and the LevelSwitch control.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { levelRowState, LevelSwitch } from './SkillControls';

describe('levelRowState', () => {
  it.each([
    [null, { on: true, from: 'global' }, true, 'on · global', false, false],
    [null, { on: false, from: 'global' }, false, 'off · global', false, true],
    [true, { on: true, from: 'global' }, true, 'on · pinned here', true, false],
    [false, { on: true, from: 'global' }, false, 'off · this issue', true, null],
    [true, { on: false, from: 'global' }, true, 'on · this issue', true, null],
    [false, { on: false, from: 'global' }, false, 'off · pinned here', true, true],
  ] as const)('maps every stored and inherited combination (%s, %s)', (current, inherited, effective, source, here, toggleTo) => {
    const result = levelRowState(current, inherited, 'issue');
    expect(result).toEqual({ effective, source, here, toggleTo });
  });

  it('names the inherited level and the current level', () => {
    expect(levelRowState(null, { on: false, from: 'project' }, 'issue').source).toBe('off · project');
    expect(levelRowState(false, { on: true, from: 'global' }, 'project').source).toBe('off · this project');
  });
});

describe('LevelSwitch', () => {
  it('an inheriting row shows a switch and a Pin button', () => {
    render(
      <LevelSwitch skill="okf" level="issue" current={null} inherited={{ on: true, from: 'global' }} saving={false} onSet={vi.fn()} />,
    );
    const switchEl = screen.getByRole('switch', { name: 'okf for this issue' });
    expect(switchEl).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('on · global')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pin okf on for this issue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reset/ })).not.toBeInTheDocument();
  });

  it('a row with a stored value shows Reset instead of Pin', () => {
    render(
      <LevelSwitch skill="okf" level="issue" current={false} inherited={{ on: true, from: 'global' }} saving={false} onSet={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Reset okf to the global default' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pin/ })).not.toBeInTheDocument();
  });

  it('a row inheriting from the project names the project setting', () => {
    render(
      <LevelSwitch skill="okf" level="issue" current={false} inherited={{ on: true, from: 'project' }} saving={false} onSet={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Reset okf to the project setting' })).toBeInTheDocument();
  });

  it('the switch, Pin and Reset call onSet with the table value', () => {
    const row1 = vi.fn();
    const { container: c1 } = render(<LevelSwitch skill="okf" level="issue" current={null} inherited={{ on: true, from: 'global' }} saving={false} onSet={row1} />);
    within(c1).getByRole('switch', { name: 'okf for this issue' }).click();
    expect(row1).toHaveBeenCalledWith(false);
    within(c1).getByRole('button', { name: 'Pin okf on for this issue' }).click();
    expect(row1).toHaveBeenCalledWith(true);

    const row2 = vi.fn();
    const { container: c2 } = render(<LevelSwitch skill="okf" level="issue" current={null} inherited={{ on: false, from: 'global' }} saving={false} onSet={row2} />);
    within(c2).getByRole('button', { name: 'Pin okf off for this issue' }).click();
    expect(row2).toHaveBeenCalledWith(false);

    const row3 = vi.fn();
    const { container: c3 } = render(<LevelSwitch skill="okf" level="issue" current={true} inherited={{ on: true, from: 'global' }} saving={false} onSet={row3} />);
    within(c3).getByRole('button', { name: 'Reset okf to the global default' }).click();
    expect(row3).toHaveBeenCalledWith(null);

    const row4 = vi.fn();
    const { container: c4 } = render(<LevelSwitch skill="okf" level="issue" current={false} inherited={{ on: true, from: 'global' }} saving={false} onSet={row4} />);
    within(c4).getByRole('switch', { name: 'okf for this issue' }).click();
    expect(row4).toHaveBeenCalledWith(null);

    const row6 = vi.fn();
    const { container: c6 } = render(<LevelSwitch skill="okf" level="issue" current={false} inherited={{ on: false, from: 'global' }} saving={false} onSet={row6} />);
    within(c6).getByRole('switch', { name: 'okf for this issue' }).click();
    expect(row6).toHaveBeenCalledWith(true);
  });

  it('disables every control while saving', () => {
    render(
      <LevelSwitch skill="okf" level="issue" current={null} inherited={{ on: true, from: 'global' }} saving={true} onSet={vi.fn()} />,
    );
    expect(screen.getByRole('switch', { name: 'okf for this issue' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pin okf on for this issue' })).toBeDisabled();
  });
});
