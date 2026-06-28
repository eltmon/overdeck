import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TtsVoiceListItem } from '../SavedVoicesTab';
import { SavedVoicesTab } from '../SavedVoicesTab';
import { SettingsRow, SettingsSection } from '../primitives';
import { TtsSystemVoicePicker } from '../TtsSystemVoicePicker';
import type { SettingsConfig, TtsConfig } from '../types';
import { VoiceDesignTab } from '../VoiceDesignTab';
import { VoicePresetsTab } from '../VoicePresetsTab';

interface TtsHealthResponse {
  ok: boolean;
  running: boolean;
  pid: number | null;
  daemonHost: string;
  daemonPort: number;
  phase?: 'stopped' | 'starting' | 'healthy' | 'unhealthy';
  initializing?: boolean;
  queueDepth?: number;
  model?: unknown;
  uptimeSeconds?: number;
  gpuMemoryUsedMb?: number;
  error?: string;
}

interface TtsConfigurationSectionProps {
  formData: SettingsConfig;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

const TTS_EVENT_KEYS = [
  'reviewStatus.passed',
  'reviewStatus.failed',
  'reviewStatus.blocked',
  'testStatus.testing',
  'testStatus.passed',
  'testStatus.failed',
  'testStatus.skipped',
  'testStatus.dispatch_failed',
  'verificationStatus.passed',
  'verificationStatus.failed',
  'verificationStatus.skipped',
  'mergeStatus.queued',
  'mergeStatus.merging',
  'mergeStatus.verifying',
  'mergeStatus.merged',
  'mergeStatus.failed',
  'readyForMerge',
] as const;

const ACTIVITY_SOURCE_OPTIONS = [
  'merge-agent',
  'review-specialist',
  'test-specialist',
  'cloister',
  'work-agent',
  'planning-agent',
  'dashboard',
  'deploy-script',
] as const;

async function fetchTtsHealth(): Promise<TtsHealthResponse> {
  const res = await fetch('/api/tts/health');
  if (!res.ok) throw new Error('Failed to fetch TTS health');
  return res.json();
}

async function startTtsDaemonRequest(): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/tts/start', { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok !== true) throw new Error(body.error ?? body.status?.error ?? 'Failed to start TTS daemon');
  return body;
}

function formatTtsUptime(seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function formatTtsGpuMemory(mb: number | undefined): string | undefined {
  if (mb === undefined) return undefined;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB VRAM` : `${mb}MB VRAM`;
}

async function fetchTtsVoices(): Promise<TtsVoiceListItem[]> {
  const res = await fetch('/api/tts/voices');
  if (!res.ok) throw new Error('Failed to fetch TTS voices');
  return res.json();
}

export function TtsConfigurationSection({ formData, onSettingsChange }: TtsConfigurationSectionProps) {
  const queryClient = useQueryClient();
  const [activeTtsVoiceTab, setActiveTtsVoiceTab] = useState<'presets' | 'design'>('presets');
  const { data: ttsHealth } = useQuery({
    queryKey: ['tts-health'],
    queryFn: fetchTtsHealth,
    refetchInterval: 10_000,
  });
  const ttsVoicesQuery = useQuery({
    queryKey: ['tts-voices'],
    queryFn: fetchTtsVoices,
    staleTime: 60_000,
  });
  const ttsVoices = ttsVoicesQuery.data ?? [];
  const ttsStartMutation = useMutation({
    mutationFn: startTtsDaemonRequest,
    onSuccess: () => {
      toast.success('TTS daemon started');
      queryClient.invalidateQueries({ queryKey: ['tts-health'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to start TTS daemon: ${error.message}`);
      queryClient.invalidateQueries({ queryKey: ['tts-health'] });
    },
  });

  const ttsConfig = formData.tts ?? {};
  const ttsVolume = ttsConfig.volume ?? 1;
  const ttsRate = ttsConfig.rate ?? 1;
  const ttsMaxChars = ttsConfig.maxChars ?? 140;
  const ttsDaemonOnline = ttsHealth?.ok === true;
  const ttsDaemonStarting = ttsHealth?.phase === 'starting' || ttsHealth?.initializing === true;
  const ttsDaemonStatus = ttsHealth === undefined ? 'checking' : ttsDaemonOnline ? 'online' : ttsDaemonStarting ? 'starting' : ttsHealth.running ? 'unhealthy' : 'offline';
  const ttsDaemonModel = typeof ttsHealth?.model === 'string' ? ttsHealth.model : undefined;
  const ttsDaemonUptime = formatTtsUptime(ttsHealth?.uptimeSeconds);
  const ttsDaemonGpuMemory = formatTtsGpuMemory(ttsHealth?.gpuMemoryUsedMb);
  const ttsDaemonDetails = [
    ttsHealth ? `${ttsHealth.daemonHost}:${ttsHealth.daemonPort}` : undefined,
    ttsHealth?.pid ? `pid ${ttsHealth.pid}` : undefined,
    ttsHealth?.queueDepth !== undefined ? `queue ${ttsHealth.queueDepth}` : undefined,
    ttsDaemonGpuMemory,
    ttsDaemonUptime ? `uptime ${ttsDaemonUptime}` : undefined,
  ].filter(Boolean).join(' | ');
  const ttsTemplateEntries = Object.entries(ttsConfig.utteranceTemplates ?? {});
  const canAddTtsTemplate = ttsTemplateEntries.length < TTS_EVENT_KEYS.length;

  const handleTtsConfigChange = (patch: Partial<TtsConfig>, options: { debounce?: boolean } = {}) => {
    const nextTts = {
      ...formData.tts,
      ...patch,
    };
    onSettingsChange({
      ...formData,
      tts: nextTts,
    }, options);
  };

  const handleTtsVoiceMapChange = (eventKey: string, voiceId: string) => {
    const nextVoiceMap = { ...(ttsConfig.voiceMap ?? {}) };
    if (voiceId) nextVoiceMap[eventKey] = voiceId;
    else delete nextVoiceMap[eventKey];
    handleTtsConfigChange({ voiceMap: nextVoiceMap });
  };

  const handleTtsMutedSourceChange = (source: string, muted: boolean) => {
    const current = ttsConfig.mutedSources ?? [];
    const nextMutedSources = muted
      ? Array.from(new Set([...current, source]))
      : current.filter((entry) => entry !== source);
    handleTtsConfigChange({ mutedSources: nextMutedSources });
  };

  const handleTtsTemplateChange = (eventKey: string, text: string) => {
    handleTtsConfigChange({
      utteranceTemplates: {
        ...(ttsConfig.utteranceTemplates ?? {}),
        [eventKey]: text,
      },
    });
  };

  const handleTtsTemplateKeyChange = (oldKey: string, newKey: string) => {
    const nextTemplates = { ...(ttsConfig.utteranceTemplates ?? {}) };
    const text = nextTemplates[oldKey] ?? '';
    delete nextTemplates[oldKey];
    nextTemplates[newKey] = text;
    handleTtsConfigChange({ utteranceTemplates: nextTemplates });
  };

  const handleRemoveTtsTemplate = (eventKey: string) => {
    const nextTemplates = { ...(ttsConfig.utteranceTemplates ?? {}) };
    delete nextTemplates[eventKey];
    handleTtsConfigChange({ utteranceTemplates: nextTemplates });
  };

  const handleAddTtsTemplate = () => {
    const templates = ttsConfig.utteranceTemplates ?? {};
    const eventKey = TTS_EVENT_KEYS.find((key) => templates[key] === undefined);
    if (!eventKey) return;
    handleTtsConfigChange({
      utteranceTemplates: {
        ...templates,
        [eventKey]: '',
      },
    });
  };

  return (
    <SettingsSection
      id="tts"
      title="TTS"
      description="Built-in voice playback"
      actions={
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs ${
          ttsHealth === undefined
            ? 'bg-muted/50 text-muted-foreground'
            : ttsDaemonOnline
              ? 'bg-success/10 text-success'
              : ttsDaemonStarting
                ? 'bg-warning/10 text-warning'
                : 'bg-destructive/10 text-destructive'
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${ttsDaemonOnline ? 'bg-success' : 'bg-current'}`} />
          Daemon status: {ttsDaemonStatus}
        </span>
      }
    >
      <SettingsRow
        label="Enable TTS"
        description="Speak activity events through the local Qwen3-TTS daemon"
      >
        <button
          type="button"
          role="switch"
          aria-checked={!!ttsConfig.enabled}
          aria-label="Toggle TTS"
          onClick={() => handleTtsConfigChange({ enabled: !ttsConfig.enabled })}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
            ttsConfig.enabled ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            ttsConfig.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`} />
        </button>
      </SettingsRow>

      <SettingsRow
        label="Daemon"
        description={ttsDaemonDetails || ttsHealth?.error || 'Live Qwen TTS daemon status'}
      >
        <div className="flex flex-col items-end gap-1.5 text-right">
          <span className={`text-sm font-medium ${ttsDaemonOnline ? 'text-success' : ttsDaemonStarting ? 'text-warning' : 'text-muted-foreground'}`}>
            {ttsDaemonOnline ? 'running' : ttsDaemonStatus}
          </span>
          {ttsDaemonModel && (
            <span className="max-w-xs truncate text-xs text-muted-foreground">{ttsDaemonModel}</span>
          )}
          {!ttsDaemonOnline && !ttsDaemonStarting && (
            <button
              type="button"
              onClick={() => ttsStartMutation.mutate()}
              disabled={ttsStartMutation.isPending}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              {ttsStartMutation.isPending ? 'Starting…' : 'Start daemon'}
            </button>
          )}
        </div>
      </SettingsRow>

      <SettingsRow
        label="Volume"
        description={`${Math.round(ttsVolume * 100)}% output volume`}
      >
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={ttsVolume}
          onChange={(e) => handleTtsConfigChange({ volume: Number(e.target.value) }, { debounce: true })}
          className="w-40 accent-primary disabled:opacity-50"
        />
        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
          {Math.round(ttsVolume * 100)}%
        </span>
      </SettingsRow>

      <SettingsRow
        label="Rate"
        description="Speech speed multiplier"
      >
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={ttsRate}
          onChange={(e) => handleTtsConfigChange({ rate: Number(e.target.value) }, { debounce: true })}
          className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
      </SettingsRow>

      <SettingsRow
        label="Max chars"
        description="Maximum text length per spoken utterance"
      >
        <input
          type="number"
          min={1}
          step={1}
          value={ttsMaxChars}
          onChange={(e) => handleTtsConfigChange({ maxChars: Number(e.target.value) }, { debounce: true })}
          className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
      </SettingsRow>

      <SettingsRow
        label="Drop info when queue full"
        description="Skip low-priority speech when the daemon queue is saturated"
      >
        <button
          type="button"
          role="switch"
          aria-checked={ttsConfig.dropInfoWhenFull ?? true}
          aria-label="Toggle dropping low-priority TTS when queue is full"
          onClick={() => handleTtsConfigChange({ dropInfoWhenFull: !(ttsConfig.dropInfoWhenFull ?? true) })}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
            (ttsConfig.dropInfoWhenFull ?? true) ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            (ttsConfig.dropInfoWhenFull ?? true) ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`} />
        </button>
      </SettingsRow>

      <TtsSystemVoicePicker
        voices={ttsVoices}
        isLoading={ttsVoicesQuery.isLoading}
        systemVoiceId={ttsConfig.voice}
        statusVoiceId={ttsConfig.statusVoice}
        onSetSystemVoice={(voiceId) => handleTtsConfigChange({ voice: voiceId })}
        onSetStatusVoice={(voiceId) => handleTtsConfigChange({ statusVoice: voiceId })}
      />

      <div className="mt-6" data-testid="tts-voice-library-tabs">
        <div className="rounded-t-xl border border-border/70 bg-card/40 p-2">
          <div className="inline-flex rounded-lg bg-background/60 p-1">
            {([
              ['presets', 'CustomVoice Presets'],
              ['design', 'VoiceDesign'],
            ] as const).map(([tabId, label]) => (
              <button
                key={tabId}
                type="button"
                onClick={() => setActiveTtsVoiceTab(tabId)}
                aria-pressed={activeTtsVoiceTab === tabId}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTtsVoiceTab === tabId
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-popover'
                }`}
                data-testid={`tts-voice-library-tab-${tabId}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {activeTtsVoiceTab === 'presets' ? <VoicePresetsTab /> : <VoiceDesignTab />}
      </div>

      <SavedVoicesTab />

      <div className="mt-6 rounded-xl border border-border/70 bg-card/40 p-4" data-testid="tts-advanced-settings">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-foreground">Advanced</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Route event types to specific voices, silence noisy activity sources, and override spoken text.
          </p>
        </div>

        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Voice Map</h4>
                <p className="text-xs text-muted-foreground mt-1">Use default falls back to the configured TTS voice.</p>
              </div>
              <span className="text-[10px] text-muted-foreground">{ttsVoices.length} saved voices</span>
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <span>Event key</span>
                <span>Voice</span>
              </div>
              {TTS_EVENT_KEYS.map((eventKey) => (
                <div key={eventKey} className="grid grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] items-center gap-3 border-t border-border px-3 py-2">
                  <code className="truncate text-xs text-foreground">{eventKey}</code>
                  <select
                    value={ttsConfig.voiceMap?.[eventKey] ?? ''}
                    onChange={(e) => handleTtsVoiceMapChange(eventKey, e.target.value)}
                    aria-label={`Voice for ${eventKey}`}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary disabled:opacity-50"
                  >
                    <option value="">Use default</option>
                    {ttsVoices.map((voice) => (
                      <option key={voice.id} value={voice.id}>{voice.name} ({voice.kind})</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Muted Sources</h4>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {ACTIVITY_SOURCE_OPTIONS.map((source) => (
                <label key={source} className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={ttsConfig.mutedSources?.includes(source) ?? false}
                    onChange={(e) => handleTtsMutedSourceChange(source, e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary disabled:opacity-50"
                  />
                  <span>{source}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Utterance Templates</h4>
                <p className="text-xs text-muted-foreground mt-1">Templates may include {'{issueId}'}.</p>
              </div>
              <button
                type="button"
                onClick={handleAddTtsTemplate}
                disabled={!canAddTtsTemplate}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-popover disabled:opacity-50"
              >
                Add template
              </button>
            </div>
            <div className="space-y-2">
              {ttsTemplateEntries.length === 0 && (
                <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  No utterance templates configured.
                </p>
              )}
              {ttsTemplateEntries.map(([eventKey, template]) => (
                <div key={eventKey} className="grid gap-2 rounded-lg border border-border bg-background/60 p-2 md:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)_auto]">
                  <select
                    value={eventKey}
                    onChange={(e) => handleTtsTemplateKeyChange(eventKey, e.target.value)}
                    aria-label="Template event key"
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary disabled:opacity-50"
                  >
                    {TTS_EVENT_KEYS.map((key) => (
                      <option key={key} value={key}>{key}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={template}
                    onChange={(e) => handleTtsTemplateChange(eventKey, e.target.value)}
                    placeholder="e.g. {issueId} passed review"
                    aria-label={`Template text for ${eventKey}`}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveTtsTemplate(eventKey)}
                    className="inline-flex items-center justify-center rounded-md border border-border px-2 py-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    aria-label={`Remove template for ${eventKey}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
