/**
 * Plain-text rendering of a preset plan (PAN-4400 D15). `pan models preset
 * show` and `apply --dry-run` print this; `--json` prints the plan object
 * itself, which is the same body `GET /api/model-presets/:id/plan` returns.
 */
import type { PresetPlan, PresetPlanRow } from './plan.js';
import { isAbsentValue, isRemovedValue } from './plan.js';

export function formatPresetValue(value: unknown): string {
  if (isAbsentValue(value)) return '(unset)';
  if (isRemovedValue(value)) return '(removed)';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function evidenceLine(plan: PresetPlan): string {
  return plan.evidence.status === 'eval'
    ? `Eval-backed: ${plan.evidence.summary} (${plan.evidence.reportPath})`
    : `Research-backed, not yet eval-tested in Overdeck: ${plan.evidence.summary} (${plan.evidence.reportPath})`;
}

export function formatPresetPlanText(plan: PresetPlan): string {
  const lines: string[] = [];
  lines.push(`${plan.label} v${plan.version} (${plan.date})${plan.pilot ? '  PILOT' : ''}`);
  lines.push(evidenceLine(plan));
  if (plan.blocked) lines.push('', `Blocked: ${plan.blocked.reason}`);

  const changes = plan.rows.filter((row) => row.status === 'change');
  const same = plan.rows.filter((row) => row.status === 'same');
  const skipped = plan.rows.filter((row) => row.status === 'skipped');

  lines.push('', `Changes (${changes.length}):`);
  if (changes.length === 0) lines.push('  none');
  let group: PresetPlanRow['group'] | undefined;
  for (const row of changes) {
    if (row.group !== group) {
      group = row.group;
      lines.push(`  [${group}]`);
    }
    lines.push(`  ${row.label}  ${formatPresetValue(row.before)} → ${formatPresetValue(row.after)}`);
  }

  if (skipped.length > 0) {
    lines.push('', `Not set (${skipped.length}):`);
    for (const row of skipped) lines.push(`  ${row.label}: ${row.reason ?? 'not set'}`);
  }
  if (same.length > 0) lines.push('', `Already set: ${same.length}`);
  if (plan.notes.length > 0) {
    lines.push('', 'Notes:');
    for (const note of plan.notes) lines.push(`  ${note}`);
  }
  return lines.join('\n');
}
