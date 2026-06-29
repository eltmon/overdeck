import type { ComplexityLevel } from '../../../../../../lib/cloister/complexity.js';

const DIFFICULTY_COLORS: Record<ComplexityLevel, string> = {
  trivial: 'badge-bg-success text-success-foreground',
  simple: 'badge-bg-success text-success-foreground',
  medium: 'badge-bg-warning text-warning-foreground',
  complex: 'badge-bg-warning text-warning-foreground',
  expert: 'badge-bg-destructive text-destructive-foreground',
};

export function DifficultyBadge({ level }: { level: ComplexityLevel }) {
  const color = DIFFICULTY_COLORS[level];
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>
      {level}
    </span>
  );
}
