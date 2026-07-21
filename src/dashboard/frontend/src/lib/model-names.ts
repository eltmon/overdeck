/**
 * Compact model-name helpers shared between the cockpit crew stage and the
 * project-overview pipeline row (PAN-2450). Keeps "gpt-5.5", "sonnet-5",
 * "fable-5", etc. consistent everywhere.
 */

export function compactModelName(model: string | undefined): string {
  if (!model) return 'model pending';
  return model.replace(/^claude-/, '').replace(/-202\d{5,8}$/, '');
}

export function initialsFor(model: string | undefined): string {
  const compact = compactModelName(model);
  const match = compact.match(/^([a-z]+)[^a-z0-9]*([\d.]*)/i);
  const word = match?.[1] ?? compact;
  const num = (match?.[2] ?? '').split('.')[0];
  return `${word.slice(0, 1).toUpperCase()}${num}`.slice(0, 3);
}
