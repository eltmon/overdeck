import { DEFAULT_EFFORT, EFFORT_LEVELS, type EffortLevel } from '@overdeck/contracts';

/**
 * Per-level hint text for the planning effort picker. Extracted alongside the
 * picker itself (PAN-4258) so PlanDialog.tsx stays under its line-count
 * ceiling; the buttons render from EFFORT_LEVELS rather than a local copy of
 * the enum.
 */
const HINTS: Record<EffortLevel, string> = {
  low: 'Quick planning — concise tasks, minimal exploration',
  medium: 'Balanced — standard planning depth',
  high: 'Deep analysis — thorough exploration, edge cases, tradeoffs',
  xhigh: 'Extended deep analysis — more exploration, probe pass included',
  max: 'Maximum depth — exhaustive exploration, probe pass included',
};

export function PlanEffortPicker({
  effort,
  onChange,
}: {
  effort: EffortLevel;
  onChange: (level: EffortLevel) => void;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-foreground mb-1.5 block">Effort</label>
      <div className="flex gap-2">
        {EFFORT_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => onChange(level)}
            className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors capitalize ${
              effort === level
                ? 'bg-signal-review/20 border-signal-review text-signal-review font-medium'
                : 'bg-popover border-border text-muted-foreground hover:text-foreground hover:border-border/80'
            }`}
          >
            {level}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {HINTS[effort]}
        {effort === DEFAULT_EFFORT ? ' (default)' : ''}
      </p>
    </div>
  );
}
