/**
 * Pure per-class precision/recall for the turn-end classifier, and a leak
 * scan for the labeled fixture set (PAN-4371). No I/O — the caller reads the
 * fixture file and the model's predictions and passes plain data in.
 */
import { TURN_END_KINDS, type TurnEndKind } from '../../src/lib/jev/questions.js';

export interface TurnEndFixture {
  name: string;
  role: string;
  text: string;
  label: TurnEndKind;
}

export interface ClassMetrics {
  precision: number | null;
  recall: number | null;
  support: number;
}

/**
 * `predicted: null` means the classifier's confidence fell below
 * TURN_END_MIN_CONFIDENCE — no prediction was made. It counts against recall
 * (a missed true positive) but is excluded from precision's denominator
 * (it is not a prediction FOR any class, so it cannot be a false positive).
 */
export function perClassMetrics(
  rows: ReadonlyArray<{ label: TurnEndKind; predicted: TurnEndKind | null }>,
): Record<TurnEndKind, ClassMetrics> {
  const result = {} as Record<TurnEndKind, ClassMetrics>;
  for (const kind of TURN_END_KINDS) {
    const support = rows.filter((r) => r.label === kind).length;
    const predictedCount = rows.filter((r) => r.predicted === kind).length;
    const truePositives = rows.filter((r) => r.label === kind && r.predicted === kind).length;
    result[kind] = {
      precision: predictedCount === 0 ? null : truePositives / predictedCount,
      recall: support === 0 ? null : truePositives / support,
      support,
    };
  }
  return result;
}

/** Home paths, private project names/issue prefixes, common token shapes, and emails. */
export const FIXTURE_LEAK_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'home-path', pattern: /\/home\/[a-z0-9_-]+|\/Users\/[a-zA-Z0-9_.-]+/ },
  { name: 'private-project-name', pattern: /\b(myn|mind your now|krux|tindra|auricle)\b/i },
  { name: 'private-issue-prefix', pattern: /\b(MIN|AUR|KRUX|TIN|ELV)-\d+\b/ },
  { name: 'slack-token', pattern: /xoxb-[A-Za-z0-9-]+/ },
  { name: 'github-token', pattern: /gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'api-key', pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'aws-key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'email', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ },
];

/** Returns `"<fixture name>: <pattern name>"` for every fixture/pattern match. */
export function findFixtureLeaks(fixtures: ReadonlyArray<TurnEndFixture>): string[] {
  const leaks: string[] = [];
  for (const fixture of fixtures) {
    for (const { name, pattern } of FIXTURE_LEAK_PATTERNS) {
      if (pattern.test(fixture.text)) {
        leaks.push(`${fixture.name}: ${name}`);
      }
    }
  }
  return leaks;
}
