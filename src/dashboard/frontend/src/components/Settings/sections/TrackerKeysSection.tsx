import { useState } from 'react';
import { Eye } from 'lucide-react';
import { type SettingsConfig } from '../types';
import { TRACKERS, type TrackerType } from '../settingsPageConstants';

interface TrackerKeysSectionProps {
  formData: SettingsConfig;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

export function TrackerKeysSection({ formData, onSettingsChange }: TrackerKeysSectionProps) {
  const [showTrackerKey, setShowTrackerKey] = useState<Record<string, boolean>>({});

  const handleTrackerKeyChange = (tracker: TrackerType, key: string) => {
    onSettingsChange({
      ...formData,
      tracker_keys: {
        ...formData.tracker_keys,
        [tracker]: key || undefined,
      },
    }, { debounce: true });
  };

  return (
    <section id="tracker-keys" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">
        Tracker Keys
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        Override environment variables ({TRACKERS.map(t => t.envVar).join(', ')}).
      </p>
      <div className="space-y-1">
        {TRACKERS.map((tracker) => {
          const trackerKey = formData.tracker_keys?.[tracker.id] || '';

          return (
            <div key={tracker.id} className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
              <tracker.icon className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{tracker.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{tracker.envVar}</span>
                </div>
                {trackerKey.startsWith('$') && (
                  <p className="text-[10px] text-warning mt-0.5">
                    Configured via env: <code className="font-mono">{trackerKey}</code>
                  </p>
                )}
              </div>
              <div className="relative w-[200px] shrink-0">
                <input
                  type={showTrackerKey[tracker.id] ? 'text' : 'password'}
                  value={trackerKey.startsWith('$') ? '' : trackerKey}
                  onChange={(e) => handleTrackerKeyChange(tracker.id, e.target.value)}
                  placeholder={trackerKey.startsWith('$') ? 'Override env value...' : tracker.placeholder}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 pr-8 text-xs font-mono focus:ring-1 focus:ring-primary focus:border-primary text-foreground"
                />
                {(trackerKey && !trackerKey.startsWith('$')) && (
                  <button
                    onClick={() => setShowTrackerKey({ ...showTrackerKey, [tracker.id]: !showTrackerKey[tracker.id] })}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showTrackerKey[tracker.id] ? 'Hide key' : 'Show key'}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
