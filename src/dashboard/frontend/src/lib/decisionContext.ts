/**
 * PAN-4754 FR-12 — lift option consequences out of an operator decision's
 * context so the dialog can show each one under its option.
 *
 * `roles/work.md` asks agents to explain each option in `--context` with a
 * bullet that starts with the option label in bold: `- **<label>:** <text>`
 * (also `* ` bullets and `**<label>**:`). A bullet whose label matches an
 * option (trimmed, case-insensitive) moves into `consequences`, keyed by the
 * option's exact label; every other line stays in `remainingContext`.
 */

const CONSEQUENCE_LINE = /^\s*[-*]\s+\*\*(.+?)(?::\*\*|\*\*:)\s*(.+)$/

export function liftOptionConsequences(
  context: string | undefined,
  optionLabels: readonly string[],
): { consequences: Record<string, string>; remainingContext: string | undefined } {
  const consequences: Record<string, string> = {}
  if (!context) return { consequences, remainingContext: undefined }

  const labelsByKey = new Map(optionLabels.map((label) => [label.trim().toLowerCase(), label]))
  const remaining: string[] = []
  for (const line of context.split('\n')) {
    const match = CONSEQUENCE_LINE.exec(line)
    const label = match ? labelsByKey.get(match[1].trim().toLowerCase()) : undefined
    if (match && label !== undefined && !(label in consequences)) {
      consequences[label] = match[2].trim()
    } else {
      remaining.push(line)
    }
  }

  const remainingContext = remaining.join('\n').trim()
  return { consequences, remainingContext: remainingContext.length > 0 ? remainingContext : undefined }
}
