import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  Eye,
  Key,
  Loader2,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { CodexAuthStatus } from '../../../hooks/useCodexAuthStatus';
import { setReauthSession } from '../../../lib/pending-codex-spawn';
import { HarnessLogo, ProviderLogo } from '../../shared/branding';
import { SensitiveText } from '../../SensitiveText';
import { OpenRouterPage } from '../OpenRouterPage';
import { MODELS_BY_PROVIDER } from '../modelCatalog';
import type { Harness, HarnessOverride, Provider, SettingsConfig } from '../types';

interface TestApiKeyResult {
  success: boolean;
  error: string | null;
  response: string | null;
  latencyMs: number;
  model?: string;
}

interface ClaudeAuthStatus {
  installed: boolean;
  loggedIn: boolean;
  expired: boolean;
  subscriptionType: string | null;
  rateLimitTier: string | null;
  expiresAt: number | null;
  hasAnthropicApiKey: boolean;
}

interface ProviderManagementSectionProps {
  claudeAuth: ClaudeAuthStatus | null;
  codexAuth: CodexAuthStatus | undefined;
  formData: SettingsConfig;
  onHarnessModelPermutationsToggle: (enabled: boolean) => void;
  onOpenRouterApiKeySaved: (savedKey: string) => void;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

const HARNESS_LABELS: Record<Harness, string> = {
  'claude-code': 'Claude Code',
  ohmypi: 'oh-my-pi',
  codex: 'Codex',
};

const PROVIDERS: { id: Provider; name: string; placeholder: string }[] = [
  { id: 'anthropic', name: 'Anthropic', placeholder: 'sk-ant-...' },
  { id: 'openai', name: 'OpenAI', placeholder: 'sk-...' },
  { id: 'google', name: 'Google', placeholder: 'AIza...' },
  { id: 'kimi', name: 'Kimi (Moonshot)', placeholder: 'sk-kimi-...' },
  { id: 'zai', name: 'Zhipu (GLM)', placeholder: 'sk-zai-...' },
  { id: 'minimax', name: 'MiniMax', placeholder: 'eyJ...' },
  { id: 'mimo', name: 'Xiaomi MiMo', placeholder: 'sk-... or tp-...' },
  { id: 'nous', name: 'Nous Portal', placeholder: 'ns-...' },
  { id: 'dashscope', name: 'Alibaba DashScope', placeholder: 'sk-...' },
];

function harnessLabel(harness: Harness): string {
  return HARNESS_LABELS[harness];
}

function formatCodexExpiry(expiresAt?: string): string | null {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Expires ${date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

async function testApiKey(provider: string, apiKey: string, model?: string): Promise<TestApiKeyResult> {
  const res = await fetch('/api/settings/test-api-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, apiKey, model }),
  });
  if (!res.ok) throw new Error('Failed to test API key');
  return res.json();
}

export function ProviderManagementSection({
  claudeAuth,
  codexAuth,
  formData,
  onHarnessModelPermutationsToggle,
  onOpenRouterApiKeySaved,
  onSettingsChange,
}: ProviderManagementSectionProps) {
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestApiKeyResult | null>>({});
  const [modelsModalProvider, setModelsModalProvider] = useState<Provider | null>(null);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [modelTestResults, setModelTestResults] = useState<Record<string, TestApiKeyResult | null>>({});
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});

  const handleProviderToggle = (provider: Provider) => {
    onSettingsChange({
      ...formData,
      models: {
        ...formData.models,
        providers: {
          ...formData.models.providers,
          [provider]: !formData.models.providers[provider],
        },
      },
    });
  };

  const handleApiKeyChange = (provider: Provider, key: string) => {
    if (provider === 'anthropic') return;
    onSettingsChange({
      ...formData,
      api_keys: {
        ...formData.api_keys,
        [provider]: key || undefined,
      },
    }, { debounce: true });
  };

  const handleProviderHarnessChange = (provider: Provider, harness: HarnessOverride) => {
    const nextProviderHarnesses = { ...formData.models.provider_harnesses };
    if (harness === '') {
      delete nextProviderHarnesses[provider];
    } else {
      nextProviderHarnesses[provider] = harness;
    }

    onSettingsChange({
      ...formData,
      models: {
        ...formData.models,
        provider_harnesses: nextProviderHarnesses,
      },
    });
  };

  const handleTestApiKey = async (provider: Provider) => {
    const apiKey = formData.api_keys[provider as keyof typeof formData.api_keys];
    if (!apiKey) return;

    setTestingProvider(provider);
    setTestResults({ ...testResults, [provider]: null });

    try {
      const result = await testApiKey(provider, apiKey);
      setTestResults({ ...testResults, [provider]: result });
    } catch {
      setTestResults({
        ...testResults,
        [provider]: { success: false, error: 'Test failed', response: null, latencyMs: 0 },
      });
    } finally {
      setTestingProvider(null);
    }
  };

  const handleTestModel = async (provider: Provider, modelId: string) => {
    const apiKey = formData.api_keys[provider as keyof typeof formData.api_keys];
    if (!apiKey) return;

    const testKey = `${provider}:${modelId}`;
    setTestingModel(testKey);
    setModelTestResults({ ...modelTestResults, [testKey]: null });

    try {
      const result = await testApiKey(provider, apiKey, modelId);
      setModelTestResults({ ...modelTestResults, [testKey]: result });
    } catch {
      setModelTestResults({
        ...modelTestResults,
        [testKey]: { success: false, error: 'Test failed', response: null, latencyMs: 0 },
      });
    } finally {
      setTestingModel(null);
    }
  };

  return (
    <>
      <section id="providers" className="py-6 scroll-mt-4">
        <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">
          Providers
        </h2>
        <div className="mb-3 flex items-center justify-between gap-4 px-4 py-3 rounded-lg border border-border/70 bg-card/40">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Show all harness/model permutations</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Off by default. When off, model pickers use each provider&apos;s default harness and hide explicit Claude Code, Pi, and Codex combinations.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(formData.experimental?.showHarnessModelPermutations)}
            aria-label="Show all harness/model permutations"
            data-testid="show-harness-model-permutations-toggle"
            onClick={() => onHarnessModelPermutationsToggle(!formData.experimental?.showHarnessModelPermutations)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
              formData.experimental?.showHarnessModelPermutations ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              formData.experimental?.showHarnessModelPermutations ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>
        <div className="space-y-1">
          {PROVIDERS.map((provider) => {
            const isDefault = provider.id === 'anthropic';
            const isEnabled = formData.models.providers[provider.id];
            const apiKey = formData.api_keys[provider.id as keyof typeof formData.api_keys] || '';
            const isExpanded = expandedProviders[provider.id] || false;
            const providerHarness = formData.models.provider_harnesses?.[provider.id] ?? '';
            const builtInHarness = formData.models.provider_default_harnesses?.[provider.id] ?? 'claude-code';

            const getAuthSummary = () => {
              if (isDefault) {
                if (claudeAuth?.loggedIn) return { text: claudeAuth.subscriptionType ? `${claudeAuth.subscriptionType} plan` : 'Subscription', variant: 'success' as const };
                if (claudeAuth?.hasAnthropicApiKey) return { text: 'API key', variant: 'neutral' as const };
                return { text: 'Not authenticated', variant: 'warning' as const };
              }
              if (provider.id === 'openai') {
                if (codexAuth?.status === 'valid') return { text: 'OAuth', variant: 'success' as const };
                if (codexAuth?.status === 'expired' || codexAuth?.status === 'burned') return { text: codexAuth.status, variant: 'warning' as const };
              }
              if (apiKey && !apiKey.startsWith('$')) return { text: 'Key configured', variant: 'success' as const };
              if (apiKey?.startsWith('$')) return { text: `via ${apiKey}`, variant: 'neutral' as const };
              return { text: 'No key', variant: 'neutral' as const };
            };

            const authSummary = getAuthSummary();

            return (
              <div key={provider.id} className="border border-transparent rounded-lg hover:border-border transition-colors">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <ProviderLogo provider={provider.id} label={provider.name} className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium text-foreground flex-1 min-w-0">{provider.name}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      authSummary.variant === 'success' ? 'text-success bg-success/10' :
                      authSummary.variant === 'warning' ? 'text-warning bg-warning/10' :
                      'text-muted-foreground bg-muted/50'
                    }`}>
                      {authSummary.text}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleProviderToggle(provider.id)}
                      role="switch"
                      aria-checked={isEnabled}
                      aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${provider.name}`}
                      className={`w-8 h-4.5 rounded-full relative transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                        isEnabled ? 'bg-primary' : 'bg-muted'
                      }`}
                    >
                      <span className={`absolute top-0.5 size-3.5 bg-white rounded-full transition-all ${
                        isEnabled ? 'right-0.5' : 'left-0.5'
                      }`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedProviders(prev => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                      className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded"
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${provider.name} details`}
                    >
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-3 pb-3 pt-0 ml-7 space-y-3">
                    {isDefault ? (
                      <div className="space-y-2">
                        {claudeAuth?.loggedIn ? (
                          <div className="flex items-center gap-2 text-xs">
                            <div className="w-1.5 h-1.5 rounded-full bg-success" />
                            <span className="text-muted-foreground">
                              Subscription{claudeAuth.subscriptionType ? ` — ${claudeAuth.subscriptionType.toUpperCase()}` : ''}
                              {claudeAuth.rateLimitTier ? ` · ${claudeAuth.rateLimitTier}` : ''}
                            </span>
                          </div>
                        ) : claudeAuth?.hasAnthropicApiKey ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Key className="w-3 h-3" />
                            <span>Using ANTHROPIC_API_KEY from environment</span>
                          </div>
                        ) : (
                          <p className="text-xs text-warning">
                            Not authenticated. Run <code className="font-mono bg-muted px-1 rounded">claude</code> and use <code className="font-mono bg-muted px-1 rounded">/login</code>.
                          </p>
                        )}
                        {claudeAuth?.hasAnthropicApiKey && claudeAuth.loggedIn && (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-warning" />
                            ANTHROPIC_API_KEY overrides subscription for direct API calls
                          </p>
                        )}
                      </div>
                    ) : provider.id === 'openai' ? (
                      <div className="space-y-2">
                        {codexAuth?.status === 'valid' ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <div className="w-1.5 h-1.5 rounded-full bg-success" />
                            <span>Subscription OAuth active</span>
                            {codexAuth.email && (
                              <SensitiveText value={codexAuth.email} className="text-[10px] text-muted-foreground" />
                            )}
                            {formatCodexExpiry(codexAuth.expiresAt) && (
                              <span className="text-[10px] text-muted-foreground">{formatCodexExpiry(codexAuth.expiresAt)}</span>
                            )}
                          </div>
                        ) : (codexAuth?.status === 'expired' || codexAuth?.status === 'burned') ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-warning capitalize">{codexAuth.status}</span>
                            {codexAuth.email && (
                              <SensitiveText value={codexAuth.email} className="text-[10px] text-muted-foreground" />
                            )}
                            {formatCodexExpiry(codexAuth.expiresAt) && (
                              <span className="text-[10px] text-muted-foreground">{formatCodexExpiry(codexAuth.expiresAt)}</span>
                            )}
                            <button
                              onClick={async () => {
                                try {
                                  const res = await fetch('/api/settings/codex-reauth', { method: 'POST' });
                                  if (!res.ok) {
                                    const body = await res.json().catch(() => ({}));
                                    throw new Error(body.error || `Failed (${res.status})`);
                                  }
                                  const { sessionName, statusToken } = await res.json() as { sessionName: string; statusToken: string };
                                  setReauthSession(sessionName, statusToken);
                                  window.location.href = `/terminal/${sessionName}`;
                                } catch (err) {
                                  toast.error(err instanceof Error ? err.message : 'Failed to start re-authentication');
                                }
                              }}
                              className="text-[10px] text-warning hover:text-warning/80 underline"
                            >
                              Re-authenticate
                            </button>
                          </div>
                        ) : null}
                        <div className="relative">
                          <input
                            type={showApiKey[provider.id] ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                            placeholder={provider.placeholder}
                            autoComplete="off"
                            className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs font-mono focus:ring-1 focus:ring-primary focus:border-primary text-foreground pr-14"
                          />
                          {apiKey && (
                            <>
                              <button
                                onClick={() => setShowApiKey({ ...showApiKey, [provider.id]: !showApiKey[provider.id] })}
                                className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                title={showApiKey[provider.id] ? 'Hide' : 'Show'}
                                aria-label={showApiKey[provider.id] ? 'Hide key' : 'Show key'}
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleApiKeyChange(provider.id, '')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive"
                                title="Remove key"
                                aria-label="Remove API key"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {apiKey.startsWith('$') ? (
                          <div className="text-xs">
                            <span className="text-muted-foreground">Env: </span>
                            <code className="font-mono text-muted-foreground">{apiKey}</code>
                            <input
                              type="text"
                              placeholder={provider.placeholder}
                              onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                              autoComplete="off"
                              className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs font-mono mt-1.5 focus:ring-1 focus:ring-primary focus:border-primary text-foreground"
                            />
                          </div>
                        ) : (
                          <div className="relative">
                            <input
                              type={showApiKey[provider.id] ? 'text' : 'password'}
                              value={apiKey}
                              onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                              placeholder={provider.placeholder}
                              autoComplete="off"
                              className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs font-mono focus:ring-1 focus:ring-primary focus:border-primary text-foreground pr-14"
                            />
                            {apiKey && (
                              <>
                                <button
                                  onClick={() => setShowApiKey({ ...showApiKey, [provider.id]: !showApiKey[provider.id] })}
                                  className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                  title={showApiKey[provider.id] ? 'Hide' : 'Show'}
                                  aria-label={showApiKey[provider.id] ? 'Hide key' : 'Show key'}
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleApiKeyChange(provider.id, '')}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive"
                                  title="Remove key"
                                  aria-label="Remove API key"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-foreground">Default harness</span>
                      <div className="flex items-center gap-2">
                        <HarnessLogo harness={(providerHarness || builtInHarness) as Harness} className="w-4 h-4 shrink-0" />
                        <select
                          value={providerHarness}
                          onChange={(event) => handleProviderHarnessChange(provider.id, event.target.value as HarnessOverride)}
                          className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary focus:border-primary"
                        >
                          <option value="">Default ({harnessLabel(builtInHarness)})</option>
                          <option value="claude-code">Claude Code</option>
                          <option value="pi">Pi</option>
                          <option value="codex">Codex</option>
                        </select>
                      </div>
                    </label>
                    {!isDefault && apiKey && !apiKey.startsWith('$') && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setModelsModalProvider(provider.id)}
                          className="text-xs text-primary hover:text-primary/80 font-medium"
                        >
                          View models
                        </button>
                        <span className="text-border">·</span>
                        <button
                          onClick={() => handleTestApiKey(provider.id)}
                          disabled={testingProvider === provider.id}
                          className="text-xs text-muted-foreground hover:text-foreground font-medium disabled:opacity-50 flex items-center gap-1"
                        >
                          {testingProvider === provider.id && <Loader2 className="w-3 h-3 animate-spin" />}
                          Test
                        </button>
                        {testResults[provider.id] && (
                          <span className={`text-[10px] ${testResults[provider.id]?.success ? 'text-success' : 'text-destructive'}`}>
                            {testResults[provider.id]?.success
                              ? `${testResults[provider.id]?.latencyMs}ms`
                              : testResults[provider.id]?.error?.slice(0, 20)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="border border-transparent rounded-lg hover:border-border transition-colors">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <ProviderLogo provider="openrouter" label="OpenRouter" className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium text-foreground flex-1">OpenRouter</span>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                  formData.api_keys.openrouter ? 'text-success bg-success/10' : 'text-muted-foreground bg-muted/50'
                }`}>
                  {formData.api_keys.openrouter ? 'Configured' : 'No key'}
                </span>
                <button
                  type="button"
                  onClick={() => handleProviderToggle('openrouter')}
                  role="switch"
                  aria-checked={!!formData.models.providers.openrouter}
                  aria-label={`${formData.models.providers.openrouter ? 'Disable' : 'Enable'} OpenRouter`}
                  className={`w-8 h-4.5 rounded-full relative transition-colors ${
                    formData.models.providers.openrouter ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`absolute top-0.5 size-3.5 bg-white rounded-full transition-all ${
                    formData.models.providers.openrouter ? 'right-0.5' : 'left-0.5'
                  }`} />
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedProviders(prev => ({ ...prev, openrouter: !prev.openrouter }))}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded"
                  aria-expanded={expandedProviders.openrouter || false}
                  aria-label={`${expandedProviders.openrouter ? 'Collapse' : 'Expand'} OpenRouter details`}
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expandedProviders.openrouter ? '' : '-rotate-90'}`} />
                </button>
              </div>
            </div>
            {expandedProviders.openrouter && (
              <div className="px-3 pb-3 pt-0 ml-7 space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-foreground">Default harness</span>
                  <div className="flex items-center gap-2">
                    <HarnessLogo
                      harness={(formData.models.provider_harnesses?.openrouter || formData.models.provider_default_harnesses?.openrouter || 'claude-code') as Harness}
                      className="w-4 h-4 shrink-0"
                    />
                    <select
                      value={formData.models.provider_harnesses?.openrouter ?? ''}
                      onChange={(event) => handleProviderHarnessChange('openrouter', event.target.value as HarnessOverride)}
                      className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary focus:border-primary"
                    >
                      <option value="">Default ({harnessLabel(formData.models.provider_default_harnesses?.openrouter ?? 'claude-code')})</option>
                      <option value="claude-code">Claude Code</option>
                      <option value="pi">Pi</option>
                      <option value="codex">Codex</option>
                    </select>
                  </div>
                </label>
                <OpenRouterPage
                  apiKey={formData.api_keys.openrouter}
                  enabled={!!formData.models.providers.openrouter}
                  onApiKeyChange={(key) => handleApiKeyChange('openrouter', key)}
                  onToggleEnabled={() => handleProviderToggle('openrouter')}
                  onApiKeySaved={onOpenRouterApiKeySaved}
                />
              </div>
            )}
          </div>
        </div>
      </section>

      {modelsModalProvider && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <ProviderLogo
                  provider={modelsModalProvider}
                  label={PROVIDERS.find(p => p.id === modelsModalProvider)?.name}
                  className="w-5 h-5 shrink-0"
                />
                <h3 className="text-foreground text-lg font-bold">
                  {PROVIDERS.find(p => p.id === modelsModalProvider)?.name} Models
                </h3>
              </div>
              <button
                onClick={() => setModelsModalProvider(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {(() => {
                const providerApiKey = formData.api_keys[modelsModalProvider as keyof typeof formData.api_keys] || '';
                const isEnvVarRef = providerApiKey.startsWith('$');

                if (!providerApiKey) {
                  return (
                    <div className="text-center py-8">
                      <Key className="w-10 h-10 text-muted-foreground mb-2 mx-auto" />
                      <p className="text-muted-foreground">Enter an API key to test models</p>
                    </div>
                  );
                }

                if (isEnvVarRef) {
                  return (
                    <div className="text-center py-8">
                      <AlertTriangle className="w-10 h-10 text-warning mb-2 mx-auto" />
                      <p className="text-warning">API key configured via environment variable</p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <code className="font-mono bg-popover px-1 rounded">{providerApiKey}</code> is not set
                      </p>
                      <p className="text-muted-foreground text-xs mt-2">Set the environment variable or enter the key directly in Settings</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-3">
                    {(MODELS_BY_PROVIDER[modelsModalProvider]?.models || []).map((model) => {
                      const testKey = `${modelsModalProvider}:${model.id}`;
                      const testResult = modelTestResults[testKey];
                      const isTesting = testingModel === testKey;

                      return (
                        <div
                          key={model.id}
                          className="bg-card border border-border rounded-lg p-4 hover:border-border transition-colors"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <div className="w-4 h-4 flex items-center justify-center text-muted-foreground text-[10px]">
                                  {typeof model.icon === 'string' ? model.icon[0] : '◆'}
                                </div>
                                <h4 className="text-foreground font-semibold">{model.name}</h4>
                                {model.tier && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                    model.tier === 'premium' ? 'badge-bg-signal-review text-signal-review-foreground' :
                                    model.tier === 'balanced' ? 'badge-bg-primary text-primary' :
                                    'badge-bg-success text-success-foreground'
                                  }`}>
                                    {model.tier}
                                  </span>
                                )}
                              </div>
                              {model.description && (
                                <p className="text-xs text-muted-foreground mb-2">{model.description}</p>
                              )}
                              <div className="flex flex-wrap gap-1">
                                {model.capabilities.map((cap) => (
                                  <span
                                    key={cap}
                                    className="text-[9px] px-1.5 py-0.5 bg-card text-muted-foreground rounded border border-border"
                                  >
                                    {cap}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <button
                                onClick={() => handleTestModel(modelsModalProvider, model.id)}
                                disabled={isTesting}
                                className="flex items-center gap-1.5 px-3 py-1.5 badge-bg-success hover:bg-success/20 border badge-border-success rounded-lg text-xs text-success-foreground transition-colors disabled:opacity-50 whitespace-nowrap"
                              >
                                {isTesting ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Zap className="w-3.5 h-3.5" />
                                )}
                                Test 2+3
                              </button>
                              {testResult && (
                                <div className={`flex items-center gap-1 text-xs ${testResult.success ? 'text-success' : 'text-destructive'}`}>
                                  {testResult.success ? (
                                    <CheckCircle className="w-3.5 h-3.5" />
                                  ) : (
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                  )}
                                  {testResult.success
                                    ? `${testResult.latencyMs}ms`
                                    : (testResult.error?.slice(0, 30) || 'Failed')}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div className="p-4 border-t border-border bg-card">
              <p className="text-xs text-muted-foreground text-center">
                Test verifies API key and model availability by asking "What is 2+3?"
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
