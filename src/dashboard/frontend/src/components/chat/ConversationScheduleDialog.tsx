import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Loader2, Pause, Pencil, Play, Trash2, X } from 'lucide-react';
import { presetToCron, SCHEDULE_PRESET_DAYS, type SchedulePreset } from '@overdeck/contracts';
import { MenuItemButton } from '../shared/ContextMenu';
import { formatLocalWhen } from '../CommandDeck/conversation-triage';
import { useDashboardStore } from '../../lib/store';

/**
 * PAN-4657: the "Schedule" dialog for one conversation — list, create, edit,
 * pause/resume and delete its recurring prompts. Opened from any conversation
 * action menu via `openScheduleDialog(name)`; one host is mounted at the app
 * root so the dialog outlives the menu that opened it.
 */

interface ConversationSchedule {
  id: number;
  conversationName: string;
  conversationTitle: string | null;
  prompt: string;
  cron: string;
  timeZone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: 'delivered' | 'failed' | 'skipped' | null;
  lastRunError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ScheduleDialogStore {
  conversationName: string | null;
  open: (conversationName: string) => void;
  close: () => void;
}

export const useScheduleDialogStore = create<ScheduleDialogStore>((set) => ({
  conversationName: null,
  open: (conversationName) => set({ conversationName }),
  close: () => set({ conversationName: null }),
}));

export function openScheduleDialog(conversationName: string): void {
  useScheduleDialogStore.getState().open(conversationName);
}

/** PAN-4657: the row/tab menu item that opens the dialog. Hidden for a read-only vault copy or a live row owned by another machine. */
export function ScheduleMenuItem({ conversation, onClose }: { conversation: { name: string; origin?: 'local' | 'vault' | 'linked' }; onClose: () => void }) {
  if (conversation.origin === 'vault' || conversation.origin === 'linked') return null;
  return (
    <MenuItemButton onClick={() => { openScheduleDialog(conversation.name); onClose(); }}>
      <CalendarClock size={14} />
      Schedule…
    </MenuItemButton>
  );
}

type RepeatMode = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'cron';

const REPEAT_OPTIONS: ReadonlyArray<{ value: RepeatMode; label: string }> = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays (Mon–Fri)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'cron', label: 'Custom cron' },
];

type CronResult = { ok: true; cron: string } | { ok: false; error: string };

/** Compiles the Repeat form fields to a cron expression. `cron` mode just trims the raw input. */
export function buildScheduleCron(mode: RepeatMode, time: string, day: string, customCron: string): CronResult {
  if (mode === 'cron') {
    const cron = customCron.trim();
    if (!cron) return { ok: false, error: 'Cron expression is required' };
    return { ok: true, cron };
  }
  try {
    const preset: SchedulePreset = mode === 'hourly'
      ? { kind: 'hourly' }
      : mode === 'weekly'
        ? { kind: 'weekly', day, time }
        : { kind: mode, time };
    return { ok: true, cron: presetToCron(preset) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function schedulesUrl(name: string, id?: number): string {
  const base = `/api/conversations/${encodeURIComponent(name)}/schedules`;
  return id === undefined ? base : `${base}/${id}`;
}

async function readJson<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error || fallbackError);
  return data as T;
}

export function ConversationScheduleDialogHost() {
  const conversationName = useScheduleDialogStore((s) => s.conversationName);
  const close = useScheduleDialogStore((s) => s.close);
  if (!conversationName) return null;
  return <ConversationScheduleDialog conversationName={conversationName} onClose={close} />;
}

interface ScheduleFormState {
  prompt: string;
  repeatMode: RepeatMode;
  time: string;
  day: string;
  customCron: string;
  timeZone: string;
}

function defaultForm(): ScheduleFormState {
  return { prompt: '', repeatMode: 'daily', time: '09:00', day: SCHEDULE_PRESET_DAYS[0], customCron: '', timeZone: browserTimeZone() };
}

export function ConversationScheduleDialog({ conversationName, onClose }: { conversationName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const queryKey = ['conversation-schedules', conversationName] as const;
  const conversationsListRevision = useDashboardStore((s) => s.conversationsListRevision);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => readJson<{ schedules: ConversationSchedule[] }>(await fetch(schedulesUrl(conversationName)), 'Failed to load schedules'),
  });
  const schedules = data?.schedules ?? [];

  useEffect(() => { promptRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    // PAN-4657 D14: refresh this dialog's own query when a sweep run (or any
    // list event) bumps the revision. The global ['conversations'] query is
    // ConversationList's job (it already invalidates on this same revision),
    // so re-invalidating it here would refetch the whole list per keystroke.
    if (conversationsListRevision > 0) {
      void queryClient.invalidateQueries({ queryKey: ['conversation-schedules', conversationName] });
    }
  }, [conversationsListRevision, conversationName, queryClient]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const resetForm = () => { setEditingId(null); setForm(defaultForm()); };

  const submit = async () => {
    const result = buildScheduleCron(form.repeatMode, form.time, form.day, form.customCron);
    if (!result.ok) { setError(result.error); return; }
    const body = { prompt: form.prompt.trim(), cron: result.cron, timeZone: form.timeZone.trim() };
    const ok = editingId === null
      ? await run(async () => readJson(await fetch(schedulesUrl(conversationName), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }), 'Failed to create schedule'))
      : await run(async () => readJson(await fetch(schedulesUrl(conversationName, editingId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }), 'Failed to update schedule'));
    if (ok) resetForm();
  };

  const startEdit = (schedule: ConversationSchedule) => {
    setError(null);
    setEditingId(schedule.id);
    setForm({
      prompt: schedule.prompt,
      repeatMode: 'cron',
      time: '09:00',
      day: SCHEDULE_PRESET_DAYS[0],
      customCron: schedule.cron,
      timeZone: schedule.timeZone,
    });
    promptRef.current?.focus();
  };

  const togglePause = (schedule: ConversationSchedule) => run(async () => readJson(await fetch(schedulesUrl(conversationName, schedule.id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: !schedule.enabled }),
  }), 'Failed to update schedule'));

  const remove = (schedule: ConversationSchedule) => run(async () => readJson(
    await fetch(schedulesUrl(conversationName, schedule.id), { method: 'DELETE' }),
    'Failed to delete schedule',
  ));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/32 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Schedules"
        className="mx-4 w-full max-w-lg rounded-2xl border border-border bg-popover text-popover-foreground shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h2 className="flex-1 text-sm font-medium">Schedules</h2>
          <button type="button" className="rounded-[var(--radius-sm)] p-1 text-muted-foreground hover:bg-accent" onClick={onClose} aria-label="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => { e.preventDefault(); void submit(); }}
          >
            <textarea
              ref={promptRef}
              className="min-h-16 w-full resize-y rounded-[var(--radius-sm)] border border-border bg-background px-2 py-1 text-[12px]"
              value={form.prompt}
              placeholder="Prompt to send on each occurrence"
              aria-label="Schedule prompt"
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="rounded-[var(--radius-sm)] border border-border bg-background px-2 py-1 text-[12px]"
                value={form.repeatMode}
                aria-label="Repeat"
                onChange={(e) => setForm((f) => ({ ...f, repeatMode: e.target.value as RepeatMode }))}
              >
                {REPEAT_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              {form.repeatMode === 'weekly' && (
                <select
                  className="rounded-[var(--radius-sm)] border border-border bg-background px-2 py-1 text-[12px]"
                  value={form.day}
                  aria-label="Day"
                  onChange={(e) => setForm((f) => ({ ...f, day: e.target.value }))}
                >
                  {SCHEDULE_PRESET_DAYS.map((d) => <option key={d} value={d}>{d[0]!.toUpperCase() + d.slice(1)}</option>)}
                </select>
              )}
              {(form.repeatMode === 'daily' || form.repeatMode === 'weekdays' || form.repeatMode === 'weekly') && (
                <input
                  type="time"
                  className="rounded-[var(--radius-sm)] border border-border bg-background px-2 py-1 text-[12px]"
                  value={form.time}
                  aria-label="Time"
                  onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                />
              )}
              {form.repeatMode === 'cron' && (
                <input
                  className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-background px-2 py-1 font-mono text-[12px]"
                  value={form.customCron}
                  placeholder="* * * * *"
                  aria-label="Cron expression"
                  onChange={(e) => setForm((f) => ({ ...f, customCron: e.target.value }))}
                />
              )}
              <input
                className="min-w-0 rounded-[var(--radius-sm)] border border-border bg-background px-2 py-1 text-[12px]"
                value={form.timeZone}
                placeholder="IANA time zone"
                aria-label="Time zone"
                onChange={(e) => setForm((f) => ({ ...f, timeZone: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="rounded-[var(--radius-sm)] border border-border px-3 py-1 text-[12px] hover:bg-accent disabled:opacity-50"
                disabled={busy || !form.prompt.trim()}
              >
                {editingId === null ? 'Create schedule' : 'Save changes'}
              </button>
              {editingId !== null && (
                <button
                  type="button"
                  className="rounded-[var(--radius-sm)] px-3 py-1 text-[12px] text-muted-foreground hover:bg-accent"
                  onClick={resetForm}
                >
                  Cancel edit
                </button>
              )}
            </div>
          </form>
          {error && <div role="alert" className="text-[12px] text-destructive-foreground">{error}</div>}

          {isLoading ? (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
          ) : schedules.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">No schedules yet.</div>
          ) : (
            <ul className="flex flex-col gap-1.5" aria-label="Schedules">
              {schedules.map((schedule) => {
                const next = schedule.enabled && schedule.nextRunAt ? `next ${formatLocalWhen(schedule.nextRunAt, new Date())}` : 'paused';
                return (
                  <li key={schedule.id} className="flex items-center gap-2 text-[12px]">
                    <span className="min-w-0 flex-1 truncate" title={schedule.prompt}>{schedule.prompt}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{`${schedule.cron} · ${schedule.timeZone}`}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{next}</span>
                    {schedule.lastRunStatus && (
                      <span className="shrink-0 text-[11px] text-muted-foreground" title={schedule.lastRunError ?? undefined}>
                        {`last ${schedule.lastRunStatus}`}
                      </span>
                    )}
                    <button
                      type="button"
                      className="shrink-0 rounded-[var(--radius-sm)] border border-border p-1 hover:bg-accent disabled:opacity-50"
                      disabled={busy}
                      onClick={() => { void togglePause(schedule); }}
                      aria-label={schedule.enabled ? `Pause schedule ${schedule.id}` : `Resume schedule ${schedule.id}`}
                      title={schedule.enabled ? 'Pause' : 'Resume'}
                    >
                      {schedule.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded-[var(--radius-sm)] border border-border p-1 hover:bg-accent disabled:opacity-50"
                      disabled={busy}
                      onClick={() => startEdit(schedule)}
                      aria-label={`Edit schedule ${schedule.id}`}
                      title="Edit"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded-[var(--radius-sm)] border border-border p-1 hover:bg-accent disabled:opacity-50"
                      disabled={busy}
                      onClick={() => { void remove(schedule); }}
                      aria-label={`Delete schedule ${schedule.id}`}
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
