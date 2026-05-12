import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2, CheckCircle, XCircle, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { OpenRouterModelBrowser, OpenRouterModel } from './OpenRouterModelBrowser';
import { cn } from '../../lib/utils';
import { invalidateAvailableModelsCache } from '../shared/ModelPicker';

// ─── API helpers ──────────────────────────────────────────────────────────────

interface OpenRouterModelsResponse {
  models: OpenRouterModel[];
  favorites: string[];
}

interface SaveOpenRouterKeyResponse {
  success: boolean;
  apiKey?: string;
  message: string;
}

async function fetchOpenRouterModels(): Promise<OpenRouterModelsResponse> {
  const res = await fetch('/api/settings/openrouter/models');
  if (!res.ok) throw new Error('Failed to fetch OpenRouter models');
  return res.json();
}

async function saveFavorites(favorites: string[]): Promise<void> {
  const res = await fetch('/api/settings/openrouter/favorites', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorites }),
  });
  if (!res.ok) throw new Error('Failed to save favorites');
}

async function saveApiKey(apiKey: string): Promise<SaveOpenRouterKeyResponse> {
  const res = await fetch('/api/settings/openrouter/api-key', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) throw new Error('Failed to save OpenRouter API key');
  return res.json();
}

async function testApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  const res = await fetch('/api/settings/openrouter/test-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) throw new Error('Failed to test API key');
  return res.json();
}

// ─── Component ────────────────────────────────────────────────────────────────

interface OpenRouterPageProps {
  /** Current API key from settings */
  apiKey?: string;
  /** Whether OpenRouter provider is enabled */
  enabled: boolean;
  onApiKeyChange: (key: string) => void;
  onApiKeySaved: (key: string) => void;
  onToggleEnabled: () => void;
}

type KeyStatus = 'idle' | 'testing' | 'valid' | 'invalid';

export function OpenRouterPage({
  apiKey,
  enabled,
  onApiKeyChange,
  onApiKeySaved,
  onToggleEnabled,
}: OpenRouterPageProps) {
  const queryClient = useQueryClient();
  const [showKey, setShowKey] = useState(false);
  const [keyInput, setKeyInput] = useState(apiKey ?? '');
  const [keyStatus, setKeyStatus] = useState<KeyStatus>('idle');
  const [keyError, setKeyError] = useState<string | undefined>();

  const { data, isLoading } = useQuery({
    queryKey: ['openrouter-models'],
    queryFn: fetchOpenRouterModels,
    staleTime: 5 * 60 * 1000, // 5-minute cache matching server TTL
  });

  const favoritesMutation = useMutation({
    mutationFn: saveFavorites,
    onSuccess: () => {
      invalidateAvailableModelsCache();
      queryClient.invalidateQueries({ queryKey: ['openrouter-models'] });
    },
    onError: () => {
      toast.error('Failed to save favorites');
    },
  });

  const saveKeyMutation = useMutation({
    mutationFn: saveApiKey,
    onSuccess: (result) => {
      const savedKey = result.apiKey ?? keyInput.trim();
      onApiKeySaved(savedKey);
      setKeyInput(savedKey);
      invalidateAvailableModelsCache();
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success(result.message);
    },
    onError: () => {
      toast.error('Failed to save OpenRouter API key');
    },
  });

  const handleTestKey = async () => {
    if (!keyInput.trim()) return;
    setKeyStatus('testing');
    setKeyError(undefined);
    try {
      const result = await testApiKey(keyInput.trim());
      if (result.valid) {
        setKeyStatus('valid');
        toast.success('OpenRouter API key is valid');
      } else {
        setKeyStatus('invalid');
        setKeyError(result.error);
      }
    } catch {
      setKeyStatus('invalid');
      setKeyError('Network error while testing key');
    }
  };

  const handleKeyChange = (v: string) => {
    setKeyInput(v);
    setKeyStatus('idle');
    setKeyError(undefined);
    onApiKeyChange(v);
  };

  const handleSaveKey = () => {
    const trimmedKey = keyInput.trim();
    if (!trimmedKey) return;
    saveKeyMutation.mutate(trimmedKey);
  };

  const handleToggleFavorite = (modelId: string) => {
    const current = data?.favorites ?? [];
    const updated = current.includes(modelId)
      ? current.filter((id) => id !== modelId)
      : [...current, modelId];
    favoritesMutation.mutate(updated);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="size-10 rounded flex items-center justify-center badge-bg-primary">
          <Globe className="size-5 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-lg leading-tight">OpenRouter</h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider badge-bg-primary text-primary border badge-border-primary">
              Router
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Access 200+ models (Qwen, DeepSeek, Llama, Mistral, and more) including free models
          </p>
        </div>
        <button
          onClick={onToggleEnabled}
          title={enabled ? 'Disable OpenRouter' : 'Enable OpenRouter'}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
            enabled ? 'bg-primary' : 'bg-card'
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
              enabled ? 'translate-x-6' : 'translate-x-1'
            )}
          />
        </button>
      </div>

      {/* API Key Section */}
      <div className="bg-card rounded-lg p-4 border border-border space-y-3">
        <label className="text-sm font-medium text-muted-foreground">API Key</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={keyInput}
              onChange={(e) => handleKeyChange(e.target.value)}
              placeholder="sk-or-..."
              className={cn(
                'w-full bg-card border rounded-md px-3 py-2 pr-10 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors',
                keyStatus === 'valid' ? 'border-success/50' :
                keyStatus === 'invalid' ? 'border-destructive/50' :
                'border-border focus:border-accent-muted'
              )}
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <button
            onClick={handleTestKey}
            disabled={!keyInput.trim() || keyStatus === 'testing'}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-accent hover:bg-accent border border-border text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {keyStatus === 'testing' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : keyStatus === 'valid' ? (
              <CheckCircle className="size-3.5 text-success" />
            ) : keyStatus === 'invalid' ? (
              <XCircle className="size-3.5 text-destructive" />
            ) : null}
            Test Key
          </button>
          <button
            onClick={handleSaveKey}
            disabled={!keyInput.trim() || saveKeyMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-primary hover:opacity-90 text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {saveKeyMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Save Key
          </button>
        </div>
        {keyStatus === 'valid' && (
          <p className="text-xs text-success flex items-center gap-1">
            <CheckCircle className="size-3" /> API key is valid
          </p>
        )}
        {keyStatus === 'invalid' && keyError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <XCircle className="size-3" /> {keyError}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Get your API key at{' '}
          <span className="text-primary font-mono">openrouter.ai/settings/keys</span>
          {' '}— free tier available, no credit card required
        </p>
        <p className="text-xs text-muted-foreground">
          Saving here updates the key immediately for new OpenRouter conversations. Already running OpenRouter sessions must be resumed or restarted to pick up the new key.
        </p>
      </div>

      {/* Model Browser */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-sm text-foreground">Model Catalog</h4>
          <span className="text-xs text-muted-foreground">
            Star models to add them to Command Deck's model picker
          </span>
        </div>
        <OpenRouterModelBrowser
          models={data?.models ?? []}
          favorites={data?.favorites ?? []}
          loading={isLoading}
          onToggleFavorite={handleToggleFavorite}
        />
      </div>
    </div>
  );
}
