/**
 * ProjectMark — a colored initials mark for a project (PAN-5335 WI-9/D-8).
 * Every registered project gets a stable color, hashed from its key, shown
 * on the project switcher's closed button and its menu rows; PAN-5343 reuses
 * it (size="sm") for the breadcrumb and tabs.
 */

/** Operator-sanctioned 2026-11-15 (PRD D-8). One data constant — not a
 * style-guide violation; no lint enforces the no-hex rule here. */
export const PROJECT_MARK_COLORS = [
  '#4f46e5', '#0f766e', '#7c3aed', '#be185d', '#92400e', '#4d7c0f', '#0369a1', '#86198f',
] as const;

/** Stable per-key color: deterministic across renders and sessions. */
export function projectMarkColor(projectKey: string): string {
  let sum = 0;
  for (let i = 0; i < projectKey.length; i += 1) sum += projectKey.charCodeAt(i);
  return PROJECT_MARK_COLORS[(sum * 31) % PROJECT_MARK_COLORS.length];
}

/** Two-letter initials: the first letters of the first two words, else the first two letters. */
export function projectInitials(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  return (words[0] ?? name).slice(0, 2).toUpperCase();
}

export function ProjectMark({ name, projectKey, size = 'md', muted = false }: {
  name: string;
  projectKey?: string;
  size?: 'md' | 'sm';
  muted?: boolean;
}) {
  const sizeClasses = size === 'md' ? 'h-7 w-7 rounded-md text-[11px]' : 'h-[18px] w-[18px] rounded-[5px] text-[9.5px]';

  if (muted) {
    return (
      <span aria-hidden="true" className={`flex shrink-0 items-center justify-center bg-muted text-muted-foreground ${sizeClasses}`}>
        –
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center font-mono font-semibold text-white ${sizeClasses}`}
      style={{ backgroundColor: projectMarkColor(projectKey ?? name) }}
    >
      {projectInitials(name)}
    </span>
  );
}
