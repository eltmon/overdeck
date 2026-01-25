import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

// Mock DifficultyBadge component for testing
const DIFFICULTY_COLORS: Record<string, string> = {
  trivial: 'bg-green-900/50 text-green-400',
  simple: 'bg-green-900/50 text-green-400',
  medium: 'bg-yellow-900/50 text-yellow-400',
  complex: 'bg-orange-900/50 text-orange-400',
  expert: 'bg-red-900/50 text-red-400',
};

function DifficultyBadge({ level }: { level: string }) {
  const color = DIFFICULTY_COLORS[level];
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>
      {level}
    </span>
  );
}

describe('DifficultyBadge', () => {
  it('should render trivial badge with green color', () => {
    const { container } = render(<DifficultyBadge level="trivial" />);
    const badge = container.querySelector('span');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('trivial');
    expect(badge?.className).toContain('bg-green-900/50');
    expect(badge?.className).toContain('text-green-400');
  });

  it('should render simple badge with green color', () => {
    const { container } = render(<DifficultyBadge level="simple" />);
    const badge = container.querySelector('span');
    expect(badge?.textContent).toBe('simple');
    expect(badge?.className).toContain('bg-green-900/50');
    expect(badge?.className).toContain('text-green-400');
  });

  it('should render medium badge with yellow color', () => {
    const { container } = render(<DifficultyBadge level="medium" />);
    const badge = container.querySelector('span');
    expect(badge?.textContent).toBe('medium');
    expect(badge?.className).toContain('bg-yellow-900/50');
    expect(badge?.className).toContain('text-yellow-400');
  });

  it('should render complex badge with orange color', () => {
    const { container } = render(<DifficultyBadge level="complex" />);
    const badge = container.querySelector('span');
    expect(badge?.textContent).toBe('complex');
    expect(badge?.className).toContain('bg-orange-900/50');
    expect(badge?.className).toContain('text-orange-400');
  });

  it('should render expert badge with red color', () => {
    const { container } = render(<DifficultyBadge level="expert" />);
    const badge = container.querySelector('span');
    expect(badge?.textContent).toBe('expert');
    expect(badge?.className).toContain('bg-red-900/50');
    expect(badge?.className).toContain('text-red-400');
  });

  it('should have consistent styling classes', () => {
    const { container } = render(<DifficultyBadge level="medium" />);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('px-1.5');
    expect(badge?.className).toContain('py-0.5');
    expect(badge?.className).toContain('rounded');
    expect(badge?.className).toContain('text-xs');
    expect(badge?.className).toContain('font-medium');
  });
});
