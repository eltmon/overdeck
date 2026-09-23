/**
 * Render an `ensureHerdr` report on an ora spinner (PAN-3956 W10) — the one
 * rendering `pan install` and `pan sync` share.
 */

import chalk from 'chalk';
import type { Ora } from 'ora';

import { isHerdrSetupSkipped, type EnsureHerdrReport } from '../lib/herdr-setup/ensure.js';

export const HERDR_DOWN_HINT =
  'Agent launches will fail until pan install succeeds or terminal.backend is set to tmux.';

/** One-line summary of the integrations step. */
function integrationSummary(report: Exclude<EnsureHerdrReport, { skipped: string }>): string {
  const { installed, already } = report.integrations;
  const parts: string[] = [];
  if (installed.length > 0) parts.push(`installed ${installed.join(', ')}`);
  if (already.length > 0) parts.push(`already ${already.join(', ')}`);
  return parts.length > 0 ? parts.join('; ') : 'none installed';
}

export function renderHerdrReport(spinner: Ora, report: EnsureHerdrReport): void {
  if (isHerdrSetupSkipped(report)) {
    spinner.info(report.skipped);
    return;
  }
  if (!report.server.running) {
    spinner.fail(`Herdr session server '${report.session}' is not running: ${report.server.reason ?? 'unknown reason'}`);
    console.log(chalk.dim(`  ${HERDR_DOWN_HINT}`));
  } else {
    const version = report.binary.version ?? 'unknown version';
    const action = report.binary.action === 'present' ? '' : ` (${report.binary.action})`;
    spinner.succeed(
      `Herdr ${version}${action}: session server ${report.session} running (${report.server.managedBy ?? 'unknown'}), `
      + `integrations: ${integrationSummary(report)}`,
    );
  }
  if (report.config.changed) {
    console.log(chalk.dim(`  Set resume_agents_on_restore = false in ${report.config.path}`));
  }
  for (const skipped of report.integrations.skipped) {
    console.log(chalk.dim(`  Herdr integration ${skipped.target} skipped: ${skipped.reason}`));
  }
  for (const warning of report.warnings) {
    console.log(chalk.dim(`  ⚠ ${warning}`));
  }
}
