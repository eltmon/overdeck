import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PROJECT_MARK_COLORS, ProjectMark, projectMarkColor } from '../ProjectMark';

describe('projectMarkColor (PAN-5335 WI-9/D-8)', () => {
  it('is pinned for the keys the PRD names', () => {
    expect(projectMarkColor('panopticon-cli')).toBe('#4f46e5');
    expect(projectMarkColor('mind-your-now')).toBe('#be185d');
    expect(projectMarkColor('dfai')).toBe('#92400e');
    expect(projectMarkColor('krux')).toBe('#0369a1');
  });

  it('is always one of the eight palette colors, and stable across calls', () => {
    const color = projectMarkColor('x');
    expect(PROJECT_MARK_COLORS).toContain(color);
    expect(projectMarkColor('x')).toBe(color);
  });
});

describe('ProjectMark (PAN-5335 WI-9/D-8)', () => {
  it('shows the colored initials with an inline background', () => {
    render(<ProjectMark name="mind-your-now" projectKey="mind-your-now" />);
    const mark = screen.getByText('MY');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveStyle({ backgroundColor: '#be185d' });
  });

  it('falls back to the name for the color hash when no projectKey is given', () => {
    render(<ProjectMark name="krux" />);
    expect(screen.getByText('KR')).toHaveStyle({ backgroundColor: '#0369a1' });
  });

  it('renders muted with no inline background', () => {
    render(<ProjectMark name="No project" muted />);
    const mark = screen.getByText('–');
    expect(mark.style.backgroundColor).toBe('');
  });
});
