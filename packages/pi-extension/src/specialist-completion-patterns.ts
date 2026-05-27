export type SpecialistCompletionStatus = 'passed' | 'failed'

export type SpecialistCompletionName = 'review-agent' | 'test-agent' | 'merge-agent' | 'inspect-agent' | 'uat-agent'

interface SpecialistPatternSet {
  name: SpecialistCompletionName
  pass: RegExp[]
  fail: RegExp[]
}

const SPECIALIST_PATTERNS: SpecialistPatternSet[] = [
  {
    name: 'review-agent',
    pass: [/review (passed|complete)/i, /\bLGTM\b/i, /no issues found/i, /code review complete/i, /✓.*passed/i, /CODE APPROVED/i],
    fail: [/review (failed|blocked)/i, /issues found/i, /needs changes/i, /\bblocked\b/i, /CHANGES REQUESTED/i],
  },
  {
    name: 'test-agent',
    pass: [/(all )?tests? passed/i, /test suite passed/i, /\b0 failed\b/i, /✓.*passed/i, /Tests PASSED/],
    fail: [/tests? failed/i, /test failures/i, /[1-9][0-9]* failed/i, /✗.*failed/i, /Tests FAILED/],
  },
  {
    name: 'merge-agent',
    pass: [/merge (complete|successful)/i, /pushed to/i, /merged to main/i, /merged successfully/i],
    fail: [/merge conflict/i, /cannot merge/i, /merge failed/i],
  },
  {
    name: 'inspect-agent',
    pass: [/INSPECTION PASSED/i],
    fail: [/INSPECTION BLOCKED/i],
  },
  {
    name: 'uat-agent',
    pass: [/UAT PASSED/i, /acceptance criteria passed/i],
    fail: [/UAT FAILED/i, /acceptance criteria failed/i],
  },
]

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

  const patterns = SPECIALIST_PATTERNS.find((entry) => entry.name === name)
  if (!patterns) return null

  const status = patterns.pass.some((pattern) => pattern.test(output))
    ? 'passed'
    : patterns.fail.some((pattern) => pattern.test(output))
      ? 'failed'
      : null
  if (!status) return null

  const summary = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-5)
    .join(' ')
    .slice(0, 1000)

  return { name, status, summary }
}
