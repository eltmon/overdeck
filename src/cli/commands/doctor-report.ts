/**
 * `pan doctor` report rendering — text and JSON (PAN-4643 FR-1, FR-2, NFR-5).
 *
 * Both `printDoctorTextReport` and `buildDoctorJsonReport` derive their exit
 * code from the same `doctorExitCode`, so `pan doctor --json` and `pan doctor`
 * always agree on the process exit code for the same checks.
 *
 * `CheckResult` is structurally identical to doctor.ts's; re-declared (like
 * doctor-first-run.ts, doctor-herdr.ts and doctor-inotify.ts) to avoid a
 * module cycle.
 */

import chalk from 'chalk';
import { listPatrolBudgetRows, type PatrolBudgetRow } from '../../lib/cloister/patrol-budget.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export interface DoctorJsonReport {
  schemaVersion: 1;
  generatedAt: string;
  strict: boolean;
  exitCode: 0 | 1;
  summary: { ok: number; warn: number; error: number };
  checks: Array<{ name: string; status: 'ok' | 'warn' | 'error'; message: string; fix: string | null }>;
  patrolBudgets: PatrolBudgetRow[];
}

export function doctorExitCode(checks: CheckResult[], strict: boolean): 0 | 1 {
  const hasErrors = checks.some((check) => check.status === 'error');
  const hasWarnings = checks.some((check) => check.status === 'warn');
  if (hasErrors) return 1;
  if (strict && hasWarnings) return 1;
  return 0;
}

export function buildDoctorJsonReport(
  checks: CheckResult[],
  options: { strict: boolean; patrolBudgets: PatrolBudgetRow[]; now: Date },
): DoctorJsonReport {
  const summary = { ok: 0, warn: 0, error: 0 };
  for (const check of checks) summary[check.status]++;

  return {
    schemaVersion: 1,
    generatedAt: options.now.toISOString(),
    strict: options.strict,
    exitCode: doctorExitCode(checks, options.strict),
    summary,
    checks: checks.map((check) => ({
      name: check.name,
      status: check.status,
      message: check.message,
      fix: check.fix ?? null,
    })),
    patrolBudgets: options.patrolBudgets,
  };
}

/**
 * PAN-3850 (W39, FR-26): print each patrol's action tally for the current UTC
 * day against its budget. A suspended patrol is a needs-you the operator
 * already got; this table is where they see the whole picture.
 */
function printPatrolBudgetTable(): void {
  console.log(chalk.bold('Patrol firing budgets (current UTC day):'));
  const rows = listPatrolBudgetRows();
  if (rows.length === 0) {
    console.log(chalk.dim('  (no patrol actions recorded today)'));
    return;
  }
  for (const row of rows) {
    const budgetText = row.budget === 'exempt' ? '(exempt)' : `of ${row.budget}`;
    const line = `  ${row.patrol}: ${row.actions} ${budgetText}${row.suspended ? ` — SUSPENDED (${row.suspendedReason ?? 'budget exceeded'})` : ''}`;
    console.log(row.suspended ? chalk.red(line) : line);
  }
}

export function printDoctorTextReport(checks: CheckResult[], options: { strict: boolean }): 0 | 1 {
  const icons = {
    ok: chalk.green('✓'),
    warn: chalk.yellow('⚠'),
    error: chalk.red('✗'),
  };

  let hasErrors = false;
  let hasWarnings = false;

  for (const check of checks) {
    const icon = icons[check.status];
    const message = check.status === 'error' ? chalk.red(check.message) :
                    check.status === 'warn' ? chalk.yellow(check.message) :
                    chalk.dim(check.message);

    console.log(`${icon} ${check.name}: ${message}`);

    if (check.fix && check.status !== 'ok') {
      console.log(chalk.dim(`  Fix: ${check.fix}`));
    }

    if (check.status === 'error') hasErrors = true;
    if (check.status === 'warn') hasWarnings = true;
  }

  // PAN-3850 (W39): the per-patrol firing-budget table — today's action tally
  // against each patrol's budget, with suspended patrols named in red.
  printPatrolBudgetTable();

  console.log('');

  if (hasErrors) {
    console.log(chalk.red('Some required components are missing.'));
    console.log(chalk.dim('Fix the errors above before using Overdeck.'));
  } else if (hasWarnings) {
    console.log(chalk.yellow('System is functional with some optional features missing.'));
  } else {
    console.log(chalk.green('All systems operational!'));
  }
  console.log('');

  return doctorExitCode(checks, options.strict);
}

export async function withStdoutReserved<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalInfo = console.info;
  console.log = console.error.bind(console);
  console.info = console.error.bind(console);
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
  }
}
