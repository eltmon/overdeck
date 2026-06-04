export type SpecialistCompletionStatus = 'passed' | 'failed'

export type SpecialistCompletionName = 'review-agent' | 'test-agent' | 'merge-agent' | 'inspect-agent' | 'uat-agent'

const RESULT_SENTINEL = /^PANOPTICON_SPECIALIST_RESULT:\s*(review-agent|test-agent|merge-agent|inspect-agent|uat-agent)\s+(passed|failed)\s*$/i

const STRUCTURED_FAILURE_PATTERNS: Partial<Record<SpecialistCompletionName, RegExp[]>> = {
  'review-agent': [/^##\s*Verdict:\s*(CHANGES REQUESTED|FAILED)\s*$/im],
  'test-agent': [/^TESTS FAILED\s*$/im],
  'merge-agent': [/^MERGE FAILED\s*$/im],
  'inspect-agent': [/^INSPECTION BLOCKED\s*$/im],
  'uat-agent': [/^UAT FAILED\s*$/im],
}

export function normalizeSpecialistCompletionName(roleOrName: string | undefined): SpecialistCompletionName | null {
  switch ((roleOrName ?? '').trim()) {
    case 'review':
    case 'review-agent':
      return 'review-agent'
    case 'test':
    case 'test-agent':
      return 'test-agent'
    case 'merge':
    case 'ship':
    case 'merge-agent':
      return 'merge-agent'
    case 'inspect':
    case 'inspect-agent':
      return 'inspect-agent'
    case 'uat':
    case 'uat-agent':
      return 'uat-agent'
    default:
      return null
  }
}

export function matchSpecialistCompletion(
  roleOrName: string | undefined,
  output: string,
): { name: SpecialistCompletionName; status: SpecialistCompletionStatus; summary: string } | null {
  const name = normalizeSpecialistCompletionName(roleOrName)
  if (!name || !output.trim()) return null

  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const tail = lines.slice(-20)
  const statuses: SpecialistCompletionStatus[] = []

  for (const line of tail) {
    const match = line.match(RESULT_SENTINEL)
    if (!match) continue
    if (normalizeSpecialistCompletionName(match[1]) !== name) continue
    statuses.push(match[2]!.toLowerCase() as SpecialistCompletionStatus)
  }

  if (STRUCTURED_FAILURE_PATTERNS[name]?.some((pattern) => pattern.test(output))) {
    statuses.push('failed')
  }

  if (statuses.includes('failed')) {
    return { name, status: 'failed', summary: summarizeSpecialistOutput(lines) }
  }
  if (statuses.includes('passed')) {
    return { name, status: 'passed', summary: summarizeSpecialistOutput(lines) }
  }
  return null
}

function summarizeSpecialistOutput(lines: string[]): string {
  return lines
    .slice(-5)
    .join(' ')
    .slice(0, 1000)
}
