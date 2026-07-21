import { useState } from 'react';
import { Eye, Mic } from 'lucide-react';
import type { VoiceHardwareSettings, VoiceSettings } from '../types';

interface VoiceSettingsSectionProps {
  voiceFormData: VoiceSettings;
  voiceHardwareSettings: VoiceHardwareSettings;
  onVoiceSettingsChange: (next: VoiceSettings, opts?: { debounce?: boolean }) => void;
  onVoiceHardwareSettingsChange: (next: VoiceHardwareSettings) => void;
}

export function VoiceSettingsSection({
  voiceFormData,
  voiceHardwareSettings,
  onVoiceSettingsChange,
  onVoiceHardwareSettingsChange,
}: VoiceSettingsSectionProps) {
  const [showVoiceApiKey, setShowVoiceApiKey] = useState(false);

  const handleVoiceProviderChange = (provider: VoiceSettings['stt']['provider']) => {
    onVoiceSettingsChange({
      ...voiceFormData,
      stt: {
        ...voiceFormData.stt,
        provider,
      },
    });
  };

  const handleMoonshineModelChange = (model: string) => {
    onVoiceSettingsChange({
      ...voiceFormData,
      stt: {
        ...voiceFormData.stt,
        moonshine: { model },
      },
    });
  };

  const handleGoogleCloudApiKeyChange = (apiKey: string) => {
    onVoiceSettingsChange({
      ...voiceFormData,
      stt: {
        ...voiceFormData.stt,
        googleCloud: {
          ...voiceFormData.stt.googleCloud,
          apiKey,
        },
      },
    }, { debounce: true });
  };

  const handleGoogleCloudModelChange = (model: string) => {
    onVoiceSettingsChange({
      ...voiceFormData,
      stt: {
        ...voiceFormData.stt,
        googleCloud: {
          ...voiceFormData.stt.googleCloud,
          model,
        },
      },
    });
  };

  const handleAutoPresoProviderChange = (provider: VoiceSettings['autopreso']['provider']) => {
    onVoiceSettingsChange({
      ...voiceFormData,
      autopreso: {
        ...voiceFormData.autopreso,
        provider,
      },
    });
  };

  const handleAutoPresoModelChange = (model: string) => {
    onVoiceSettingsChange({
      ...voiceFormData,
      autopreso: {
        ...voiceFormData.autopreso,
        model,
      },
    }, { debounce: true });
  };

  const handleVoiceHardwareChange = <K extends keyof VoiceHardwareSettings>(
    key: K,
    value: VoiceHardwareSettings[K],
  ) => {
    onVoiceHardwareSettingsChange({
      ...voiceHardwareSettings,
      [key]: value,
    });
  };

  return (
    <section id="voice" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
        <Mic className="w-4 h-4 text-muted-foreground" />
        Voice
      </h2>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">STT provider</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Speech-to-text backend used by the voice widget and AutoPreso
            </p>
          </div>
          <select
            value={voiceFormData.stt.provider}
            onChange={(e) => handleVoiceProviderChange(e.target.value as VoiceSettings['stt']['provider'])}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          >
            <option value="moonshine">Moonshine</option>
            <option value="google-cloud">Google Cloud STT</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">AutoPreso provider</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Whiteboard agent backend used for live diagram updates
            </p>
          </div>
          <select
            value={voiceFormData.autopreso.provider}
            onChange={(e) => handleAutoPresoProviderChange(e.target.value as VoiceSettings['autopreso']['provider'])}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          >
            <option value="openai">OpenAI</option>
            <option value="codex">Codex</option>
            <option value="ollama">Ollama</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">AutoPreso model</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Model passed to the whiteboard agent
            </p>
          </div>
          <input
            type="text"
            value={voiceFormData.autopreso.model}
            onChange={(e) => handleAutoPresoModelChange(e.target.value)}
            placeholder="gpt-4.1-mini"
            className="w-[260px] bg-background border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>

        {voiceFormData.stt.provider === 'moonshine' ? (
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">Moonshine model</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tiny is faster; base is more accurate
              </p>
            </div>
            <select
              value={voiceFormData.stt.moonshine.model}
              onChange={(e) => handleMoonshineModelChange(e.target.value)}
              className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
            >
              <option value="tiny">Tiny</option>
              <option value="base">Base</option>
            </select>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground">Google Cloud API key</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Used only when Google Cloud STT is selected
                </p>
              </div>
              <div className="relative w-[260px] shrink-0">
                <input
                  type={showVoiceApiKey ? 'text' : 'password'}
                  value={voiceFormData.stt.googleCloud.apiKey}
                  onChange={(e) => handleGoogleCloudApiKeyChange(e.target.value)}
                  placeholder="Google Cloud API key"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 pr-8 text-xs font-mono focus:ring-1 focus:ring-primary focus:border-primary text-foreground"
                />
                {voiceFormData.stt.googleCloud.apiKey && (
                  <button
                    type="button"
                    onClick={() => setShowVoiceApiKey(!showVoiceApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showVoiceApiKey ? 'Hide Google Cloud API key' : 'Show Google Cloud API key'}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground">Google Cloud model</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Recognition model passed to Google Cloud STT
                </p>
              </div>
              <select
                value={voiceFormData.stt.googleCloud.model}
                onChange={(e) => handleGoogleCloudModelChange(e.target.value)}
                className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
              >
                <option value="latest_long">Latest long</option>
                <option value="latest_short">Latest short</option>
                <option value="command_and_search">Command and search</option>
              </select>
            </div>
          </>
        )}

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Input device</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Browser microphone device ID stored on this machine
            </p>
          </div>
          <input
            type="text"
            value={voiceHardwareSettings.inputDevice}
            onChange={(e) => handleVoiceHardwareChange('inputDevice', e.target.value)}
            placeholder="Default microphone"
            className="w-[260px] bg-background border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Output device</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Browser speaker device ID stored on this machine
            </p>
          </div>
          <input
            type="text"
            value={voiceHardwareSettings.outputDevice}
            onChange={(e) => handleVoiceHardwareChange('outputDevice', e.target.value)}
            placeholder="Default speaker"
            className="w-[260px] bg-background border border-border rounded-md px-2.5 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Voice volume</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Playback volume stored on this machine
            </p>
          </div>
          <div className="flex items-center gap-3 w-[260px] shrink-0">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={voiceHardwareSettings.volume}
              onChange={(e) => handleVoiceHardwareChange('volume', Number(e.target.value))}
              aria-label="Voice volume"
              className="flex-1 accent-primary"
            />
            <span className="text-xs text-muted-foreground tabular-nums w-9 text-right">
              {Math.round(voiceHardwareSettings.volume * 100)}%
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
