/**
 * One-click provider presets for Settings → Model Routing (PAN-4400).
 *
 * Each button previews the preset's diff (GET /api/model-presets/:id/plan)
 * in PresetDiffDialog; confirming applies it with the plan's digest, so a
 * config that changed after the preview is refused rather than overwritten.
 * The preset writes config.yaml through its own path-scoped door, so the
 * page's formData is stale afterwards; `onPresetChanged` lets SettingsPage
 * refresh it before the next autosave.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { invalidateAvailableModelsCache } from '../shared/ModelPicker';
import { PresetDiffDialog, type PresetPlan } from './PresetDiffDialog';

export interface PresetStatus {
  id: string;
  label: string;
  provider: 'anthropic' | 'openai';
  version: number;
  date: string;
  pilot: boolean;
  evidence: { status: 'eval' | 'research'; reportPath: string; summary: string };
  lastApplied?: { presetId: string; version: number; appliedAt: string };
  updateAvailable: boolean;
}

interface PresetStatusList {
  presets: PresetStatus[];
  undoAvailable: boolean;
}

interface PresetUndoResult {
  restored: string[];
  leftAsIs: { path: string; reason: string }[];
}

async function responseError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : `${fallback} (HTTP ${res.status})`;
}

async function fetchPresetStatus(): Promise<PresetStatusList> {
  const res = await fetch('/api/model-presets');
  if (!res.ok) throw new Error(await responseError(res, 'Failed to load model presets'));
  return res.json();
}

async function fetchPresetPlan(id: string): Promise<PresetPlan> {
  const res = await fetch(`/api/model-presets/${encodeURIComponent(id)}/plan`);
  if (!res.ok) throw new Error(await responseError(res, 'Failed to preview preset'));
  return res.json();
}

interface ModelPresetsBarProps {
  onPresetChanged: () => void;
}

export function ModelPresetsBar({ onPresetChanged }: ModelPresetsBarProps) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['model-presets'], queryFn: fetchPresetStatus });
  const [plan, setPlan] = useState<PresetPlan | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const refreshAfterWrite = () => {
    invalidateAvailableModelsCache();
    void queryClient.invalidateQueries({ queryKey: ['settings'] });
    void queryClient.invalidateQueries({ queryKey: ['model-presets'] });
    void queryClient.invalidateQueries({ queryKey: ['available-models'] });
    onPresetChanged();
  };

  const undo = async () => {
    try {
      const res = await fetch('/api/model-presets/undo', {
        method: 'POST',
        headers: await dashboardMutationJsonHeaders(),
        body: '{}',
      });
      if (!res.ok) {
        toast.error(await responseError(res, 'Failed to undo preset'));
        return;
      }
      const result = await res.json() as PresetUndoResult;
      refreshAfterWrite();
      const leftAsIs = result.leftAsIs.length > 0 ? `; ${result.leftAsIs.length} changed since apply were left as is` : '';
      toast.success(`Restored ${result.restored.length} settings${leftAsIs}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const openPreset = async (id: string) => {
    setLoadingId(id);
    try {
      setApplyError(null);
      setPlan(await fetchPresetPlan(id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingId(null);
    }
  };

  const confirmApply = async () => {
    if (!plan) return;
    setBusy(true);
    setApplyError(null);
    try {
      const res = await fetch(`/api/model-presets/${encodeURIComponent(plan.presetId)}/apply`, {
        method: 'POST',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ expectedDigest: plan.digest }),
      });
      if (!res.ok) {
        setApplyError(await responseError(res, 'Failed to apply preset'));
        return;
      }
      const label = plan.label;
      setPlan(null);
      refreshAfterWrite();
      toast(`Applied ${label}`, {
        duration: 10_000,
        action: { label: 'Undo', onClick: () => { void undo(); } },
      });
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const presets = data?.presets ?? [];
  if (presets.length === 0) return null;
  const updated = presets.filter((preset) => preset.updateAvailable);

  return (
    <div className="mb-4 space-y-2">
      {updated.map((preset) => (
        <p key={preset.id} className="text-[11px] leading-snug text-warning" role="status">
          {preset.label} updated (v{preset.version}):{' '}
          <button
            type="button"
            onClick={() => { void openPreset(preset.id); }}
            className="underline hover:opacity-80"
          >
            review changes
          </button>
        </p>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => { void openPreset(preset.id); }}
            disabled={loadingId !== null || busy}
            className="px-3 py-1.5 text-sm rounded-md border border-border text-foreground hover:bg-muted/30 transition-colors disabled:opacity-50"
          >
            Apply {preset.label}
          </button>
        ))}
        {data?.undoAvailable && (
          <button
            type="button"
            onClick={() => { void undo(); }}
            disabled={busy}
            className="px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Undo last preset
          </button>
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        A preset writes explicit values for the model settings once, after you review the changes. It never applies on its own.
      </p>
      <PresetDiffDialog
        open={plan !== null}
        plan={plan}
        busy={busy}
        error={applyError}
        onConfirm={() => { void confirmApply(); }}
        onCancel={() => { setPlan(null); setApplyError(null); }}
      />
    </div>
  );
}
