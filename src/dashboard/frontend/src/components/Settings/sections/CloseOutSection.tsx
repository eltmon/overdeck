import { type Dispatch, type SetStateAction } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../../lib/wsTransport';
import { type CloseOutSettingsView } from '../SettingsPage.types';
import { type SaveStatus } from '../hooks/useAutosavePipeline';
import { SettingsRow, SettingsRowStatus } from '../primitives';

interface CloseOutSectionProps {
  markSaveError: () => void;
  markSaved: () => void;
  setSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
}

type WritableCloseOutKey = 'remove_workspace' | 'delete_feature_branch';

async function fetchCloseOutSettings(): Promise<CloseOutSettingsView> {
  const res = await fetch('/api/cloister/close-out');
  if (!res.ok) throw new Error(`Failed to fetch close-out settings (${res.status})`);
  return res.json();
}

async function saveCloseOutSetting(key: WritableCloseOutKey, value: boolean): Promise<CloseOutSettingsView> {
  await ensureDashboardSession();
  const res = await fetch('/api/cloister/close-out', {
    method: 'PUT',
    credentials: 'include',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to save close-out settings (${res.status})`);
  }
  const parsed = await res.json() as { settings: CloseOutSettingsView };
  return parsed.settings;
}

function sourceLabel(source: 'default' | 'cloister.toml'): string {
  return source === 'cloister.toml' ? 'cloister.toml' : 'default';
}

interface ClosedIssueWorkspaceReport {
  closedCount: number;
  totalBytes: number;
  unknownSizeCount: number;
  trackerReadsPaused: boolean;
  computedAt: string;
}

interface CloseOutCleanupResult {
  removed: Array<{ issueId: string; freedBytes: number | null }>;
  skipped: Array<{ issueId: string; reason: string }>;
}

async function fetchCloseOutDiskReport(): Promise<ClosedIssueWorkspaceReport> {
  const res = await fetch('/api/cloister/close-out/disk');
  if (!res.ok) throw new Error(`Failed to fetch closed-issue workspace disk report (${res.status})`);
  return res.json();
}

async function runCloseOutCleanup(): Promise<CloseOutCleanupResult> {
  await ensureDashboardSession();
  const res = await fetch('/api/cloister/close-out/cleanup', {
    method: 'POST',
    credentials: 'include',
    headers: await dashboardMutationJsonHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to clean up closed-issue workspaces (${res.status})`);
  }
  return res.json();
}

function formatDiskBytes(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function CloseOutDiskLine() {
  const queryClient = useQueryClient();
  const { data: report, isLoading } = useQuery({
    queryKey: ['close-out-disk'],
    queryFn: fetchCloseOutDiskReport,
  });

  const cleanup = useMutation({
    mutationFn: runCloseOutCleanup,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['close-out-disk'] });
    },
    onError: (err) => {
      toast.error(`Clean up failed: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  let text: string;
  if (isLoading || !report) {
    text = 'Measuring closed-issue workspaces…';
  } else if (report.closedCount === 0) {
    text = 'No closed issues have workspaces on disk.';
  } else {
    text = `${report.closedCount} closed issue(s) still have workspaces (${formatDiskBytes(report.totalBytes)})`;
    if (report.unknownSizeCount > 0) text += ` — size unknown for ${report.unknownSizeCount}`;
    if (report.trackerReadsPaused) text += ' GitHub reads are paused; this count may be incomplete.';
  }

  return (
    <div className="px-4 pb-2">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">{text}</p>
        <button
          type="button"
          data-testid="close-out-cleanup"
          disabled={!report || report.closedCount === 0 || cleanup.isPending}
          onClick={() => cleanup.mutate()}
          title="Runs `pan workspace destroy` (also deletes the local branch) for closed, merged issues whose workspaces have no uncommitted changes."
          className="text-xs px-2 py-1 rounded-md border border-border bg-background hover:bg-muted/50 disabled:opacity-50 shrink-0"
        >
          {cleanup.isPending ? 'Cleaning up…' : 'Clean up now'}
        </button>
      </div>
      {cleanup.data && (
        <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
          {cleanup.data.removed.map((r) => (
            <p key={`removed-${r.issueId}`}>Removed {r.issueId}</p>
          ))}
          {cleanup.data.skipped.map((s) => (
            <p key={`skipped-${s.issueId}`}>{`Skipped ${s.issueId} — ${s.reason}`}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  label,
  testId,
  onClick,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

export function CloseOutSection({ markSaveError, markSaved, setSaveStatus }: CloseOutSectionProps) {
  const queryClient = useQueryClient();
  const { data: view, error } = useQuery({
    queryKey: ['close-out-settings'],
    queryFn: fetchCloseOutSettings,
  });

  const save = useMutation({
    mutationFn: ({ key, value }: { key: WritableCloseOutKey; value: boolean }) => saveCloseOutSetting(key, value),
    onMutate: async ({ key, value }) => {
      setSaveStatus('saving');
      const previous = queryClient.getQueryData<CloseOutSettingsView>(['close-out-settings']);
      if (previous) {
        queryClient.setQueryData(['close-out-settings'], {
          ...previous,
          [key]: { ...previous[key], value, source: 'cloister.toml' },
        });
      }
      return { previous };
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(['close-out-settings'], settings);
      markSaved();
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['close-out-settings'], context.previous);
      } else {
        void queryClient.invalidateQueries({ queryKey: ['close-out-settings'] });
      }
      markSaveError();
      toast.error(`Failed to save close-out settings: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const toggle = (key: WritableCloseOutKey, current: boolean) => {
    save.mutate({ key, value: !current });
  };

  return (
    <section id="close-out" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
        <Trash2 className="w-4 h-4 text-muted-foreground" />
        Close-out
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        What <code>pan close</code> and the Close Out button do after an issue&apos;s PR has merged. Saved to{' '}
        <code>~/.overdeck/cloister.toml</code>.
      </p>
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          Failed to load close-out settings: {error instanceof Error ? error.message : String(error)}
        </div>
      ) : (
        <div className="space-y-1">
          <SettingsRow
            label="Remove the workspace when an issue is closed out"
            description="Stops the workspace's Docker stack, TLDR daemon and stray processes and removes the worktree. Branches and memory are kept."
            status={view && <SettingsRowStatus variant="neutral" label={sourceLabel(view.remove_workspace.source)} />}
          >
            <ToggleSwitch
              checked={view?.remove_workspace.value ?? true}
              disabled={!view || save.isPending}
              label="Remove the workspace when an issue is closed out"
              testId="close-out-remove-workspace"
              onClick={() => view && toggle('remove_workspace', view.remove_workspace.value)}
            />
          </SettingsRow>
          <CloseOutDiskLine />

          <SettingsRow
            label="Delete the feature branch at close-out"
            description="Deletes the local and remote feature branch."
            status={view && <SettingsRowStatus variant="neutral" label={sourceLabel(view.delete_feature_branch.source)} />}
          >
            <ToggleSwitch
              checked={view?.delete_feature_branch.value ?? false}
              disabled={!view || save.isPending}
              label="Delete the feature branch at close-out"
              testId="close-out-delete-branch"
              onClick={() => view && toggle('delete_feature_branch', view.delete_feature_branch.value)}
            />
          </SettingsRow>

          <SettingsRow
            label="Close out merged issues automatically"
            description="Not in effect. Automatic close-out was removed in PAN-3917; nothing reads this key. Close out with pan close <id> or the Close Out button."
            status={view && <SettingsRowStatus variant="neutral" label={sourceLabel(view.auto.source)} />}
          >
            <ToggleSwitch
              checked={view?.auto.value ?? true}
              disabled
              label="Close out merged issues automatically"
              testId="close-out-auto"
              onClick={() => {}}
            />
          </SettingsRow>

          <SettingsRow
            label="Automatic close-out delay (minutes)"
            description="Not in effect. Automatic close-out was removed in PAN-3917; nothing reads this key. Close out with pan close <id> or the Close Out button."
            status={view && <SettingsRowStatus variant="neutral" label={sourceLabel(view.auto_delay_minutes.source)} />}
          >
            <input
              type="number"
              disabled
              data-testid="close-out-auto-delay"
              value={view?.auto_delay_minutes.value ?? 60}
              readOnly
              className="w-24 bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground disabled:opacity-50"
            />
          </SettingsRow>
        </div>
      )}
    </section>
  );
}
