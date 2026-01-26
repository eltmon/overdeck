import { useState } from 'react';
import { Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Provider } from '../types';
import { Toggle } from '../Shared/Toggle';
import { StatusDot } from '../Shared/StatusDot';
import { ThinkingLevelSlider } from './ThinkingLevelSlider';

export interface ProviderCardProps {
  provider: Provider;
  displayName: string;
  icon: string;
  iconColor: string;
  enabled: boolean;
  connected: boolean;
  apiKey?: string;
  locked?: boolean;
  showThinkingLevel?: boolean;
  thinkingLevel?: number;
  onToggle: () => void;
  onApiKeyChange: (key: string) => void;
  onThinkingLevelChange?: (level: number) => void;
  onTestConnection?: () => Promise<void>;
}

export function ProviderCard({
  provider,
  displayName,
  icon,
  iconColor,
  enabled,
  connected,
  apiKey,
  locked = false,
  showThinkingLevel = false,
  thinkingLevel = 3,
  onToggle,
  onApiKeyChange,
  onThinkingLevelChange,
  onTestConnection,
}: ProviderCardProps) {
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleTestConnection = async () => {
    if (!onTestConnection || testing) return;
    setTesting(true);
    try {
      await onTestConnection();
    } finally {
      setTesting(false);
    }
  };

  const isConfigured = !!apiKey && apiKey.length > 0;
  const status = testing ? 'testing' : connected ? 'connected' : 'disconnected';

  return (
    <div className="bg-[#24283b] rounded-lg p-6 flex flex-col gap-5 border border-slate-700/50">
      {/* Header with Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn('size-10 rounded flex items-center justify-center', `bg-[${iconColor}]/20`)}>
            <span className="material-symbols-outlined" style={{ color: iconColor }}>
              {icon}
            </span>
          </div>
          <div>
            <h3 className="font-bold text-lg leading-tight">{displayName}</h3>
            <span className="text-xs font-medium flex items-center gap-1">
              <StatusDot status={status} />
              {testing ? (
                <span className="text-[#fbbf24]">Testing...</span>
              ) : connected ? (
                <span className="text-[#10b981]">Connected</span>
              ) : (
                <span className="text-[#a390cb]">Not Configured</span>
              )}
            </span>
          </div>
        </div>
        <Toggle checked={enabled} onChange={onToggle} locked={locked} />
      </div>

      {/* API Key Input */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          enabled ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[#a390cb] uppercase tracking-wider flex items-center gap-2">
            API Key
            {connected && <CheckCircle className="text-[#10b981] size-4" />}
          </label>
          <div className={cn('relative', showThinkingLevel && 'space-y-4')}>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey || ''}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder={`Enter ${provider === 'openai' ? 'sk-' : provider === 'google' ? 'AIza' : ''}...`}
                disabled={locked}
                className={cn(
                  'w-full bg-[#161022] border-slate-700 rounded-lg text-sm text-white px-3 py-2 pr-10 focus:ring-[#a078f7] focus:border-[#a078f7]',
                  locked && 'bg-[#161022]/50 text-slate-400 cursor-not-allowed'
                )}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-2 text-slate-400 hover:text-white"
                disabled={locked}
              >
                {locked ? (
                  <span className="material-symbols-outlined text-lg">lock</span>
                ) : showKey ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Test Connection Button */}
            {!locked && !connected && isConfigured && (
              <div className="flex gap-2">
                <input className="flex-1" disabled />
                <button
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="bg-[#2e2249] hover:bg-[#3d2d61] text-xs font-bold px-3 py-2 rounded-lg transition-colors flex items-center gap-2"
                >
                  {testing && <Loader2 className="w-3 h-3 animate-spin" />}
                  Test Connection
                </button>
              </div>
            )}

            {/* Gemini Thinking Level (Google only) */}
            {showThinkingLevel && connected && (
              <div className="pl-2 border-l-2 border-slate-700 ml-5">
                <ThinkingLevelSlider value={thinkingLevel} onChange={onThinkingLevelChange!} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
