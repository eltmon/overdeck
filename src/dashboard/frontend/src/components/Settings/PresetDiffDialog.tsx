/**
 * Diff dialog for a model preset (PAN-4400). Renders the same plan object the
 * CLI prints: the settings that will change (before → after), the settings
 * the preset will not set and why, and notes. A blocked plan shows its reason
 * and cannot be confirmed.
 */

import { AlertTriangle, Loader2 } from 'lucide-react';

import { Modal } from '../shared/Modal';
import formStyles from '../shared/ModalForm.module.css';

export interface PresetPlanRow {
  path: string;
  label: string;
  group: string;
  before: unknown;
  after: unknown;
  status: 'change' | 'same' | 'skipped';
  reason?: string;
}

export interface PresetPlan {
  presetId: string;
  version: number;
  date: string;
  provider: 'anthropic' | 'openai';
  label: string;
  pilot: boolean;
  evidence: { status: 'eval' | 'research'; reportPath: string; summary: string };
  blocked?: { reason: string };
  rows: PresetPlanRow[];
  notes: string[];
  digest: string;
}

interface PresetDiffDialogProps {
  open: boolean;
  plan: PresetPlan | null;
  busy?: boolean;
  /** Error from the last apply attempt (for example a 409 when config.yaml changed). */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function isMarker(value: unknown, key: 'absent' | 'removed'): boolean {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>)[key] === true && Object.keys(value).length === 1;
}

export function formatPresetValue(value: unknown): string {
  if (isMarker(value, 'absent')) return '(unset)';
  if (isMarker(value, 'removed')) return '(removed)';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function PresetDiffDialog({ open, plan, busy = false, error = null, onConfirm, onCancel }: PresetDiffDialogProps) {
  if (!open || !plan) return null;

  const changes = plan.rows.filter((row) => row.status === 'change');
  const skipped = plan.rows.filter((row) => row.status === 'skipped');
  const sameCount = plan.rows.filter((row) => row.status === 'same').length;
  const evidence = plan.evidence.status === 'eval' ? 'Eval-backed' : 'Research-backed, not yet eval-tested';

  return (
    <Modal
      title={`${plan.label} v${plan.version}`}
      description={`${evidence} · ${plan.date}${plan.pilot ? ' · Pilot' : ''}`}
      onClose={onCancel}
      dismissible={!busy}
      pinned={error ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={busy} className={formStyles.button}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || Boolean(plan.blocked) || changes.length === 0}
            className={formStyles.primaryButton}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Apply {changes.length} changes
          </button>
        </>
      }
    >
      <div className={`${formStyles.content} space-y-4 text-sm text-muted-foreground`}>
        <p className="text-xs leading-relaxed">{plan.evidence.summary}</p>

        {plan.blocked && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{plan.blocked.reason}</span>
          </div>
        )}

        <div>
          <h4 className="text-xs font-medium text-foreground mb-1">Changes ({changes.length})</h4>
          {changes.length === 0 ? (
            <p className="text-xs">Nothing to change.</p>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {changes.map((row) => (
                  <tr key={row.path} className="border-t border-border/50 align-top">
                    <td className="py-1 pr-3 text-foreground">{row.label}</td>
                    <td className="py-1 font-mono break-all">
                      {formatPresetValue(row.before)} <span className="text-muted-foreground">→</span>{' '}
                      <span className="text-foreground">{formatPresetValue(row.after)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {skipped.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-foreground mb-1">Not set ({skipped.length})</h4>
            <ul className="space-y-1 text-xs">
              {skipped.map((row) => (
                <li key={row.path}>
                  <span className="text-foreground">{row.label}:</span> {row.reason ?? 'not set'}
                </li>
              ))}
            </ul>
          </div>
        )}

        {sameCount > 0 && <p className="text-xs">Already set: {sameCount}</p>}

        {plan.notes.length > 0 && (
          <ul className="space-y-1 text-xs">
            {plan.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        )}
      </div>
    </Modal>
  );
}
