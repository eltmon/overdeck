/**
 * One labelled checkbox row for the planning dialog's options block.
 *
 * Extracted in PAN-4198 while adding the "Start work as soon as the plan is
 * ready" option: PlanDialog.tsx is held at its line count by the file-size
 * ratchet (scripts/file-size-allowlist.txt), and four near-identical inline
 * blocks were the obvious thing to collapse.
 *
 * Accent classes are written out rather than interpolated — Tailwind only sees
 * class names that appear literally in the source.
 */
const ACCENTS = {
  'signal-review': 'text-signal-review focus:ring-signal-review',
  primary: 'text-primary focus:ring-primary',
} as const;

export function PlanOptionCheckbox({
  checked,
  onChange,
  label,
  hint,
  accent = 'signal-review',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
  accent?: keyof typeof ACCENTS;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className={`w-4 h-4 rounded border-border bg-popover focus:ring-offset-background ${ACCENTS[accent]}`}
      />
      <span className="text-sm text-foreground">
        {label}
        <span className="text-muted-foreground ml-1">{hint}</span>
      </span>
    </label>
  );
}
