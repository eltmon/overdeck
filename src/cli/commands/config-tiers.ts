import chalk from 'chalk';
import { loadConfigSync } from '../../lib/config-yaml/load.js';
import { resolveModel } from '../../lib/config-yaml/roles.js';
import { effectiveTierTable, type EffectiveTierTable } from '../../lib/agents/tier-table.js';

/**
 * PAN-4191: `pan admin config tiers` — the effective model per tier, with
 * `workhorse:` refs resolved, and a marker on every tier that shadows
 * roles.work for planned issues while tiered execution is on.
 */
export function formatEffectiveTierTable(table: EffectiveTierTable, invalidReason?: string): string[] {
  const lines = [`roles.work → ${table.workModel}`];
  if (invalidReason) {
    lines.push(chalk.red(`tiered_execution is INVALID and disabled: ${invalidReason}`));
    return lines;
  }
  if (table.rows.length === 0) {
    lines.push(chalk.dim('tiered_execution: no tiers configured; every work agent uses roles.work'));
    return lines;
  }
  lines.push(`tiered_execution: ${table.enabled ? 'enabled' : chalk.dim('disabled (tiers below are not used; roles.work applies)')}`);
  for (const row of table.rows) {
    const declared = row.ref === row.model ? row.model : `${row.ref} → ${row.model}`;
    const weight = row.weight !== undefined ? ` ${row.weight}%` : '';
    const override = row.overridesWork ? chalk.yellow('  [overrides roles.work]') : '';
    lines.push(`  ${row.tierName}${weight}  ${declared}  (${row.harness}; ${row.difficulties.join(', ')})${override}`);
  }
  if (table.rows.some((row) => row.overridesWork)) {
    lines.push(chalk.dim('Planned issues take their tier\'s model, not roles.work. Point a tier at workhorse:<slot> to follow the workhorse settings.'));
  }
  return lines;
}

export function configTiersCommand(): void {
  const { config } = loadConfigSync();
  const table = effectiveTierTable(config.tieredExecution, resolveModel('work', undefined, config));
  for (const line of formatEffectiveTierTable(table, config.tieredExecutionInvalid?.reason)) console.log(line);
}
