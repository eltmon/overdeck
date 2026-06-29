import { type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../../lib/wsTransport';
import { type CloisterConfig } from '../SettingsPage.types';
import { AUTOSAVE_DEBOUNCE_MS, type SaveStatus } from '../hooks/useAutosavePipeline';

interface CloisterSectionProps {
  cloisterConfigError: unknown;
  cloisterFormData: CloisterConfig | null;
  cloisterSaveDebounceRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  markSaveError: () => void;
  markSaved: () => void;
  setCloisterFormData: Dispatch<SetStateAction<CloisterConfig | null>>;
  setSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
}

async function saveCloisterConfig(config: CloisterConfig): Promise<void> {
  await ensureDashboardSession();
  const res = await fetch('/api/cloister/config', {
    method: 'PUT',
    credentials: 'include',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to save Cloister config (${res.status})`);
  }
}

export function CloisterSection({
  cloisterConfigError,
  cloisterFormData,
  cloisterSaveDebounceRef,
  markSaveError,
  markSaved,
  setCloisterFormData,
  setSaveStatus,
}: CloisterSectionProps) {
  const queryClient = useQueryClient();

  const saveCloisterSnapshot = async (snapshot: CloisterConfig) => {
    setSaveStatus('saving');
    try {
      await saveCloisterConfig(snapshot);
      queryClient.setQueryData(['cloister-config'], snapshot);
      queryClient.invalidateQueries({ queryKey: ['cloister-config'] });
      markSaved();
    } catch (error) {
      markSaveError();
      toast.error(`Failed to save Cloister settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const updateCloisterConcurrency = (
    key: 'max_work_agents' | 'reserved_advancing_slots',
    rawValue: string,
  ) => {
    if (!cloisterFormData) return;
    const next: CloisterConfig = {
      ...cloisterFormData,
      concurrency: {
        ...cloisterFormData.concurrency,
        [key]: rawValue === '' ? undefined : Number(rawValue),
      },
    };
    setCloisterFormData(next);
    if (cloisterSaveDebounceRef.current) {
      clearTimeout(cloisterSaveDebounceRef.current);
      cloisterSaveDebounceRef.current = null;
    }
    cloisterSaveDebounceRef.current = setTimeout(() => {
      cloisterSaveDebounceRef.current = null;
      void saveCloisterSnapshot(next);
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  return (
    <section id="cloister" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
        <Flag className="w-4 h-4 text-muted-foreground" />
        Cloister
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        Deacon dispatch limits for automatically resumed work agents and review, test, and ship specialists.
      </p>
      {cloisterConfigError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          Failed to load Cloister settings: {cloisterConfigError instanceof Error ? cloisterConfigError.message : String(cloisterConfigError)}
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Max work agents</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Running work-agent ceiling used by auto-resume before the deacon defers more work.
              </p>
            </div>
            <input
              type="number"
              min="1"
              step="1"
              disabled={!cloisterFormData}
              value={cloisterFormData?.concurrency?.max_work_agents ?? 6}
              onChange={(e) => updateCloisterConcurrency('max_work_agents', e.target.value)}
              className="w-24 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Reserved advancing slots</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Extra slots above the work cap reserved for review, test, and ship dispatch.
              </p>
            </div>
            <input
              type="number"
              min="0"
              step="1"
              disabled={!cloisterFormData}
              value={cloisterFormData?.concurrency?.reserved_advancing_slots ?? 3}
              onChange={(e) => updateCloisterConcurrency('reserved_advancing_slots', e.target.value)}
              className="w-24 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          </div>
        </div>
      )}
    </section>
  );
}
