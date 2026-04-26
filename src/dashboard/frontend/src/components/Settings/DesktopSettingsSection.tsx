/**
 * Desktop settings section — shown only when running inside the Electron app.
 *
 * Covers:
 *   - Tray: show agent badge, tooltip detail level
 *   - Notifications: per-event-type toggles
 *   - Auto-start: enable/disable + reset nag counter
 *
 * Settings are persisted via panopticonBridge IPC to the main process.
 * Hidden entirely when window.panopticonBridge is undefined (browser mode).
 */

import { useState, useEffect, useCallback } from 'react';
import { Monitor, Bell, ToggleLeft, ToggleRight, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

// ─── Bridge types (re-exported for convenience) ───────────────────────────────

type DesktopSettings = PanopticonBridgeDesktopSettings;
type NotificationEventType = keyof DesktopSettings['notifications'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isDesktopApp(): boolean {
  return window.panopticonBridge?.isDesktopApp() === true;
}

// ─── Toggle component ─────────────────────────────────────────────────────────

function Toggle({ checked, onChange, label, description }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex-1 min-w-0 mr-4">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
        aria-label={checked ? `Disable ${label}` : `Enable ${label}`}
      >
        {checked ? (
          <ToggleRight className="w-8 h-8 text-primary" />
        ) : (
          <ToggleLeft className="w-8 h-8" />
        )}
      </button>
    </div>
  );
}

// ─── Event type labels ────────────────────────────────────────────────────────

const NOTIFICATION_LABELS: Record<NotificationEventType, { label: string; description: string }> = {
  inputNeeded:   { label: 'Input Needed', description: 'Agent is waiting for your decision' },
  stuckAgents:   { label: 'Stuck Agents', description: 'Agent has been idle too long' },
  mergeFailures: { label: 'Merge Failures', description: 'Merge specialist encountered an error' },
  workComplete:  { label: 'Work Complete', description: 'Agent finished and called pan done' },
  planningDone:  { label: 'Planning Done', description: 'Planning session completed' },
  mergeReady:    { label: 'Merge Ready', description: 'PR is ready for your approval' },
};

// ─── Main component ───────────────────────────────────────────────────────────

export function DesktopSettingsSection() {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isDesktopApp()) {
      setLoading(false);
      return;
    }
    window.panopticonBridge!.getDesktopSettings()
      .then((s) => setSettings(s))
      .catch(() => toast.error('Failed to load desktop settings'))
      .finally(() => setLoading(false));
  }, []);

  const updateSetting = useCallback(async (key: string, value: unknown) => {
    if (!window.panopticonBridge) return;
    setSaving(true);
    try {
      await window.panopticonBridge.updateDesktopSetting(key, value);
      // Optimistically update local state
      setSettings((prev) => {
        if (!prev) return prev;
        const [section, field] = key.split('.');
        if (!section || !field) return prev;
        return {
          ...prev,
          [section]: { ...(prev as unknown as Record<string, Record<string, unknown>>)[section], [field]: value },
        } as unknown as DesktopSettings;
      });
    } catch {
      toast.error('Failed to save desktop setting');
    } finally {
      setSaving(false);
    }
  }, []);

  const resetNagCounter = useCallback(async () => {
    await updateSetting('autoStart.nagCount', 0);
    await updateSetting('autoStart.nagDismissed', false);
    toast.success('Auto-start reminder will show on next launch');
  }, [updateSetting]);

  // Not inside Electron — hide section entirely
  if (!isDesktopApp()) return null;

  if (loading) {
    return (
      <section className="mb-12">
        <h2 className="text-foreground text-2xl font-bold mb-6 flex items-center gap-3">
          Desktop App
          <div className="h-px flex-1 bg-divider-strong" />
        </h2>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading desktop settings…</span>
        </div>
      </section>
    );
  }

  if (!settings) return null;

  return (
    <section className="mb-12">
      <h2 className="text-foreground text-2xl font-bold mb-6 flex items-center gap-3">
        Desktop App
        <div className="h-px flex-1 bg-divider-strong" />
        {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Tray */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="size-9 rounded-lg bg-card border border-border flex items-center justify-center">
              <Monitor className="w-4 h-4 text-muted-foreground" />
            </div>
            <h3 className="font-bold text-foreground">System Tray</h3>
          </div>
          <div className="divide-y divide-divider">
            <Toggle
              checked={settings.tray.showBadge}
              onChange={(v) => void updateSetting('tray.showBadge', v)}
              label="Show agent count badge"
              description="Displays active agent count on dock/taskbar icon"
            />
            <div className="py-2">
              <label className="text-sm font-medium text-foreground block mb-1">Tooltip detail</label>
              <select
                value={settings.tray.tooltipDetail}
                onChange={(e) => void updateSetting('tray.tooltipDetail', e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-primary focus:border-primary"
              >
                <option value="minimal">Minimal — agent count only</option>
                <option value="full">Full — count + attention + activity</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="size-9 rounded-lg bg-card border border-border flex items-center justify-center">
              <Bell className="w-4 h-4 text-muted-foreground" />
            </div>
            <h3 className="font-bold text-foreground">Notifications</h3>
          </div>
          <div className="divide-y divide-divider">
            {(Object.entries(NOTIFICATION_LABELS) as [NotificationEventType, typeof NOTIFICATION_LABELS[NotificationEventType]][]).map(
              ([key, { label, description }]) => (
                <Toggle
                  key={key}
                  checked={settings.notifications[key]}
                  onChange={(v) => void updateSetting(`notifications.${key}`, v)}
                  label={label}
                  description={description}
                />
              ),
            )}
          </div>
        </div>

        {/* Auto-start */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="size-9 rounded-lg bg-card border border-border flex items-center justify-center">
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
            </div>
            <h3 className="font-bold text-foreground">Auto-start</h3>
          </div>
          <div className="divide-y divide-divider">
            <Toggle
              checked={settings.autoStart.enabled}
              onChange={(v) => void updateSetting('autoStart.enabled', v)}
              label="Launch at login"
              description="Start Panopticon automatically when you log in"
            />
            <div className="pt-3">
              <p className="text-xs text-muted-foreground mb-3">
                {settings.autoStart.nagDismissed
                  ? 'Auto-start reminders have been dismissed.'
                  : settings.autoStart.nagCount > 0
                  ? `Reminder shown ${settings.autoStart.nagCount} time${settings.autoStart.nagCount !== 1 ? 's' : ''}.`
                  : 'No reminders shown yet.'}
              </p>
              <button
                type="button"
                onClick={() => void resetNagCounter()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-primary border border-border rounded-lg transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Reset reminder
              </button>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
