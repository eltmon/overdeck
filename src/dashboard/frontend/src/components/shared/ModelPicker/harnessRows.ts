import type { Harness } from './ModelPicker';

/**
 * Harness-labeled picker rows (2026-08-02).
 *
 * The model picker used to list bare model ids and silently apply the
 * provider-default harness at spawn, so rows like "Kimi K3 (native)" implied
 * a launch behavior they didn't control — every row launched the same way and
 * the label was meaningless. These helpers expand Kimi models into one row
 * per launch route, so the row itself states the harness it spawns:
 *
 *   Kimi K3 (256K) — Claude Code      bare id, Anthropic-compatible route
 *   Kimi K3 (256K) — Kimi Code CLI    kimi-code/* id, native CLI direct
 *   Kimi K3 (256K) — ACP (Kimi Code)  kimi-code/* id, native CLI over ACP
 *
 * The spawn layer (resolveHarness `explicit`) honors the row's harness, so the
 * label is a guarantee, not a hint. Id spaces are not interchangeable: bare
 * Kimi ids exist only on the Anthropic-compatible route, and `kimi-code/*`
 * ids only exist in the native CLI's catalog (shared by kimi-code and ACP —
 * KIMI_ACP_MODEL_IDS / KIMI_LEGACY_MODEL_TO_NATIVE_ALIAS stay in sync
 * server-side). Other providers keep a single row whose harness follows the
 * provider default.
 */

export const KIMI_NATIVE_EFFORT_LEVELS = ['low', 'high', 'max'] as const;

const HARNESS_ROW_LABELS = {
  'claude-code': 'Claude Code',
  'kimi-code': 'Kimi Code CLI',
  acp: 'ACP (Kimi Code)',
} as const;

type RowBase = {
  id: string;
  label: string;
  provider: string;
  /** Clean display name without a harness suffix (from the available-models API). */
  baseName?: string;
  harness?: Harness;
};

/**
 * Expand a group's models into harness-labeled rows. Idempotent — a row that
 * already carries an explicit harness passes through unchanged.
 */
export function expandHarnessRows<T extends RowBase>(models: T[]): T[] {
  const out: T[] = [];
  for (const m of models) {
    if (m.provider !== 'kimi' || m.harness !== undefined) {
      out.push(m);
      continue;
    }
    const base = m.baseName ?? m.label;
    if (m.id.startsWith('kimi-code/')) {
      out.push({ ...m, label: `${base} — ${HARNESS_ROW_LABELS['kimi-code']}`, harness: 'kimi-code' });
      out.push({ ...m, label: `${base} — ${HARNESS_ROW_LABELS.acp}`, harness: 'acp' });
    } else {
      out.push({ ...m, label: `${base} — ${HARNESS_ROW_LABELS['claude-code']}`, harness: 'claude-code' });
    }
  }
  return out;
}

/**
 * Effort-level override for the composer's EffortPicker. The native `kimi`
 * binary's /effort offers low/high/max only — surface exactly that for
 * kimi-code/* ids instead of Claude Code's full five. Everything else returns
 * undefined ("no model-specific restriction" → the picker shows all levels,
 * which is correct for the claude-code route).
 */
export function pickerEffortLevels(modelId: string): readonly string[] | undefined {
  if (modelId.startsWith('kimi-code/')) return KIMI_NATIVE_EFFORT_LEVELS;
  return undefined;
}
