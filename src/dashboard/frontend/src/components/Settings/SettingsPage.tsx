import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { SettingsConfig, Provider, WorkTypeId, ModelId } from './types';
import {
  ModelOverrideModal,
  getCapabilityMatchScore,
  getModelById,
  WORK_TYPE_CAPABILITIES,
  CAPABILITY_INFO,
  Capability,
  MODELS_BY_PROVIDER,
} from './AgentCards/ModelOverrideModal';

// API Functions
async function fetchSettings(): Promise<SettingsConfig> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

async function saveSettings(settings: SettingsConfig): Promise<void> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to save settings');
  }
}

async function fetchOptimalDefaults(): Promise<SettingsConfig> {
  const res = await fetch('/api/settings/optimal-defaults');
  if (!res.ok) throw new Error('Failed to fetch optimal defaults');
  return res.json();
}

interface TestApiKeyResult {
  success: boolean;
  error: string | null;
  response: string | null;
  latencyMs: number;
  model?: string;
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

// Provider definitions
const PROVIDERS: { id: Provider; name: string; icon: string; placeholder: string }[] = [
  { id: 'anthropic', name: 'Anthropic', icon: 'deployed_code', placeholder: 'sk-ant-...' },
  { id: 'openai', name: 'OpenAI', icon: 'auto_awesome', placeholder: 'sk-...' },
  { id: 'google', name: 'Google', icon: 'cloud', placeholder: 'AIza...' },
  { id: 'kimi', name: 'Kimi (Moonshot)', icon: 'token', placeholder: 'sk-kimi-...' },
  { id: 'zai', name: 'Zhipu (GLM)', icon: 'hub', placeholder: 'sk-zai-...' },
];

// Agent definitions organized by category
interface AgentDef { id: WorkTypeId; name: string; icon: string; description: string }
interface AgentCategory { name: string; icon: string; agents: AgentDef[] }

const AGENT_CATEGORIES: AgentCategory[] = [
  {
    name: 'Issue Agent Phases',
    icon: 'list_alt',
    agents: [
      { id: 'issue-agent:exploration' as WorkTypeId, name: 'Exploration', icon: 'search', description: 'Codebase discovery' },
      { id: 'issue-agent:planning' as WorkTypeId, name: 'Planning', icon: 'event_note', description: 'Implementation design' },
      { id: 'issue-agent:implementation' as WorkTypeId, name: 'Implementation', icon: 'code', description: 'Write the code' },
      { id: 'issue-agent:testing' as WorkTypeId, name: 'Testing', icon: 'science', description: 'Write & run tests' },
      { id: 'issue-agent:documentation' as WorkTypeId, name: 'Documentation', icon: 'description', description: 'Update docs' },
      { id: 'issue-agent:review-response' as WorkTypeId, name: 'Review Response', icon: 'reply', description: 'Address PR feedback' },
    ],
  },
  {
    name: 'Specialist Agents',
    icon: 'psychology',
    agents: [
      { id: 'specialist-review-agent' as WorkTypeId, name: 'Review Agent', icon: 'rate_review', description: 'Automated code reviews' },
      { id: 'specialist-test-agent' as WorkTypeId, name: 'Test Agent', icon: 'science', description: 'Test generation' },
      { id: 'specialist-merge-agent' as WorkTypeId, name: 'Merge Agent', icon: 'call_merge', description: 'Merge conflict resolution' },
    ],
  },
  {
    name: 'Convoy Reviewers',
    icon: 'groups',
    agents: [
      { id: 'convoy:security-reviewer' as WorkTypeId, name: 'Security', icon: 'shield', description: 'Security analysis' },
      { id: 'convoy:performance-reviewer' as WorkTypeId, name: 'Performance', icon: 'speed', description: 'Performance review' },
      { id: 'convoy:correctness-reviewer' as WorkTypeId, name: 'Correctness', icon: 'check_circle', description: 'Logic validation' },
      { id: 'convoy:synthesis-agent' as WorkTypeId, name: 'Synthesis', icon: 'merge', description: 'Combine reviews' },
    ],
  },
  {
    name: 'Subagents',
    icon: 'account_tree',
    agents: [
      { id: 'subagent:explore' as WorkTypeId, name: 'Explore', icon: 'explore', description: 'Codebase exploration' },
      { id: 'subagent:plan' as WorkTypeId, name: 'Plan', icon: 'event_note', description: 'Task breakdown' },
      { id: 'subagent:bash' as WorkTypeId, name: 'Bash', icon: 'terminal', description: 'CLI commands' },
      { id: 'subagent:general-purpose' as WorkTypeId, name: 'General', icon: 'psychology', description: 'General tasks' },
    ],
  },
  {
    name: 'Workflow Agents',
    icon: 'route',
    agents: [
      { id: 'prd-agent' as WorkTypeId, name: 'PRD Agent', icon: 'article', description: 'Product requirements' },
      { id: 'decomposition-agent' as WorkTypeId, name: 'Decomposition', icon: 'account_tree', description: 'Break down epics' },
      { id: 'triage-agent' as WorkTypeId, name: 'Triage', icon: 'filter_list', description: 'Prioritize issues' },
      { id: 'planning-agent' as WorkTypeId, name: 'Planning', icon: 'event', description: 'Sprint planning' },
    ],
  },
  {
    name: 'CLI Modes',
    icon: 'terminal',
    agents: [
      { id: 'cli:interactive' as WorkTypeId, name: 'Interactive', icon: 'chat', description: 'Conversation mode' },
      { id: 'cli:quick-command' as WorkTypeId, name: 'Quick Command', icon: 'bolt', description: 'One-shot queries' },
    ],
  },
];

// Default model
const DEFAULT_MODEL = 'claude-sonnet-4-5';

function getModelDisplay(modelId?: string): string {
  if (!modelId) return 'Default';
  const model = getModelById(modelId as ModelId);
  if (model) return model.name;
  // Fallback for unknown models
  if (modelId.includes('claude')) return modelId.includes('opus') ? 'Opus 4.5' : modelId.includes('haiku') ? 'Haiku' : 'Sonnet 4.5';
  if (modelId.includes('gpt')) return 'GPT-4o';
  if (modelId.includes('gemini')) return modelId.includes('flash') ? 'Gemini Flash' : 'Gemini Pro';
  if (modelId.includes('kimi')) return 'Kimi K2';
  if (modelId.includes('glm')) return 'GLM-4';
  return modelId;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  const [formData, setFormData] = useState<SettingsConfig | null>(null);
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [modalWorkType, setModalWorkType] = useState<WorkTypeId | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestApiKeyResult | null>>({});
  const [modelsModalProvider, setModelsModalProvider] = useState<Provider | null>(null);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [modelTestResults, setModelTestResults] = useState<Record<string, TestApiKeyResult | null>>({});

  useEffect(() => {
    if (settings && !formData) {
      setFormData(settings);
    }
  }, [settings, formData]);

  const saveMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  if (error || !formData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400">Error: {(error as Error)?.message || 'Failed to load settings'}</div>
      </div>
    );
  }

  const hasChanges = JSON.stringify(formData) !== JSON.stringify(settings);

  const handleProviderToggle = (provider: Provider) => {
    if (provider === 'anthropic') return;
    setFormData({
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
    setFormData({
      ...formData,
      api_keys: {
        ...formData.api_keys,
        [provider]: key || undefined,
      },
    });
  };

  const handleSetOverride = (workType: WorkTypeId, model: ModelId) => {
    setFormData({
      ...formData,
      models: {
        ...formData.models,
        overrides: {
          ...formData.models.overrides,
          [workType]: model,
        },
      },
    });
  };

  const handleRemoveOverride = (workType: WorkTypeId) => {
    const { [workType]: _removed, ...remainingOverrides } = formData.models.overrides;
    setFormData({
      ...formData,
      models: {
        ...formData.models,
        overrides: remainingOverrides,
      },
    });
  };

  const handleSave = () => saveMutation.mutate(formData);
  const handleReset = () => setFormData(settings || null);

  const handleRestoreOptimalDefaults = async () => {
    try {
      const optimalDefaults = await fetchOptimalDefaults();
      // Deep clone to ensure React detects the change
      const newFormData: SettingsConfig = {
        models: {
          providers: { ...(formData?.models.providers || optimalDefaults.models.providers) },
          overrides: { ...optimalDefaults.models.overrides },
          gemini_thinking_level: optimalDefaults.models.gemini_thinking_level,
        },
        api_keys: { ...(formData?.api_keys || {}) },
      };
      setFormData(newFormData);
    } catch (error) {
      console.error('Failed to fetch optimal defaults:', error);
      alert('Failed to load optimal defaults: ' + (error as Error).message);
    }
  };

  const handleTestApiKey = async (provider: Provider) => {
    const apiKey = formData?.api_keys[provider as keyof typeof formData.api_keys];
    if (!apiKey) return;

    setTestingProvider(provider);
    setTestResults({ ...testResults, [provider]: null });

    try {
      const result = await testApiKey(provider, apiKey);
      setTestResults({ ...testResults, [provider]: result });
    } catch (error) {
      setTestResults({
        ...testResults,
        [provider]: { success: false, error: 'Test failed', response: null, latencyMs: 0 },
      });
    } finally {
      setTestingProvider(null);
    }
  };

  const handleTestModel = async (provider: Provider, modelId: string) => {
    const apiKey = formData?.api_keys[provider as keyof typeof formData.api_keys];
    if (!apiKey) return;

    const testKey = `${provider}:${modelId}`;
    setTestingModel(testKey);
    setModelTestResults({ ...modelTestResults, [testKey]: null });

    try {
      const result = await testApiKey(provider, apiKey, modelId);
      setModelTestResults({ ...modelTestResults, [testKey]: result });
    } catch (error) {
      setModelTestResults({
        ...modelTestResults,
        [testKey]: { success: false, error: 'Test failed', response: null, latencyMs: 0 },
      });
    } finally {
      setTestingModel(null);
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto px-6 md:px-10 py-8 pb-32">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-blue-400 text-2xl">settings</span>
            <h1 className="text-white text-4xl font-black tracking-tight">Settings</h1>
          </div>
          <p className="text-slate-400 text-base">Configure AI model orchestration and agent permissions.</p>
        </div>
      </div>

      {/* Smart Model Selection Hero */}
      <section className="mb-10">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
          <div className="flex flex-col lg:flex-row">
            {/* Visualization */}
            <div className="lg:w-2/5 bg-slate-900/50 p-8 flex flex-col justify-center items-center border-b lg:border-b-0 lg:border-r border-slate-700 relative overflow-hidden">
              <div className="absolute inset-0 opacity-10 pointer-events-none bg-[radial-gradient(circle_at_50%_50%,#3b82f6_0%,transparent_70%)]" />
              <div className="relative z-10 flex flex-col items-center gap-6 w-full max-w-xs">
                <div className="flex items-center justify-between w-full">
                  <div className="size-12 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
                    <span className="material-symbols-outlined text-slate-400">terminal</span>
                  </div>
                  <div className="flex-1 h-px bg-gradient-to-r from-slate-700 via-blue-500 to-slate-700 mx-2" />
                  <div className="size-12 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
                    <span className="material-symbols-outlined text-blue-400">account_tree</span>
                  </div>
                  <div className="flex-1 h-px bg-gradient-to-r from-slate-700 via-blue-500 to-slate-700 mx-2" />
                  <div className="size-12 rounded-lg bg-blue-500 flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.4)]">
                    <span className="material-symbols-outlined text-white">bolt</span>
                  </div>
                </div>
                <div className="flex justify-between w-full px-2 text-[10px] uppercase tracking-widest font-bold text-slate-500">
                  <span>Task</span>
                  <span>Capability</span>
                  <span>Model</span>
                </div>
              </div>
            </div>
            {/* Content */}
            <div className="lg:w-3/5 p-8">
              <div className="flex items-center gap-2 mb-4">
                <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-bold uppercase tracking-wider rounded border border-blue-500/20">Active</span>
                <h3 className="text-white text-xl font-bold">Smart Model Selection</h3>
              </div>
              <p className="text-slate-400 mb-6 leading-relaxed">
                Panopticon automatically routes tasks to the optimal model based on capabilities, token budget, and latency requirements.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-blue-400 text-sm mt-1">check_circle</span>
                  <div>
                    <p className="text-sm font-semibold text-slate-200">Capability Matching</p>
                    <p className="text-xs text-slate-500">Best model for each task type</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-blue-400 text-sm mt-1">check_circle</span>
                  <div>
                    <p className="text-sm font-semibold text-slate-200">Cost Optimization</p>
                    <p className="text-xs text-slate-500">Balance performance vs spend</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Provider Configuration */}
      <section className="mb-12">
        <h2 className="text-white text-2xl font-bold mb-6 flex items-center gap-3">
          Provider Configuration
          <div className="h-px flex-1 bg-slate-700" />
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {PROVIDERS.map((provider) => {
            const isDefault = provider.id === 'anthropic';
            const isEnabled = isDefault || formData.models.providers[provider.id];
            const apiKey = formData.api_keys[provider.id as keyof typeof formData.api_keys] || '';

            return (
              <div
                key={provider.id}
                className={`bg-slate-800/50 border rounded-xl p-5 relative transition-colors ${
                  isDefault
                    ? 'border-blue-500/50 shadow-lg shadow-blue-500/5'
                    : 'border-slate-700 hover:border-slate-600'
                }`}
              >
                {isDefault && (
                  <div className="absolute -top-3 right-4">
                    <span className="bg-blue-500 text-white text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-tighter">
                      Default
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3 mb-5">
                  <div className="size-10 rounded-lg bg-slate-800 flex items-center justify-center">
                    <span className="material-symbols-outlined text-slate-400">{provider.icon}</span>
                  </div>
                  <span className="font-bold text-white">{provider.name}</span>
                  <div className="ml-auto">
                    <button
                      onClick={() => handleProviderToggle(provider.id)}
                      disabled={isDefault}
                      className={`w-10 h-5 rounded-full relative transition-colors ${
                        isEnabled ? 'bg-blue-500' : 'bg-slate-700'
                      } ${isDefault ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div
                        className={`absolute top-0.5 size-4 bg-white rounded-full transition-all ${
                          isEnabled ? 'right-0.5' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="relative">
                    <label className="text-[10px] uppercase font-bold text-slate-400 mb-1 block">API Key</label>
                    {/* Check if it's an unresolved env var reference */}
                    {apiKey.startsWith('$') ? (
                      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2 text-amber-400 text-xs">
                          <span className="material-symbols-outlined text-[14px]">info</span>
                          <span>Configured via <code className="font-mono bg-slate-800 px-1 rounded">{apiKey}</code></span>
                        </div>
                        <p className="text-[10px] text-amber-400/70 mt-1">
                          Set this environment variable or enter the key directly below
                        </p>
                        <input
                          type="text"
                          placeholder={provider.placeholder}
                          onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                          autoComplete="off"
                          className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono mt-2 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-slate-300"
                        />
                      </div>
                    ) : (
                      <div className="relative">
                        <input
                          type={showApiKey[provider.id] ? 'text' : 'password'}
                          value={apiKey}
                          onChange={(e) => handleApiKeyChange(provider.id, e.target.value)}
                          disabled={isDefault}
                          placeholder={provider.placeholder}
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          data-lpignore="true"
                          data-1p-ignore="true"
                          data-form-type="other"
                          className={`w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 pr-16 text-xs font-mono focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${
                            isDefault ? 'cursor-not-allowed text-slate-500' : 'text-slate-300'
                          }`}
                        />
                        {!isDefault && (
                          <button
                            onClick={() => setShowApiKey({ ...showApiKey, [provider.id]: !showApiKey[provider.id] })}
                            className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              {showApiKey[provider.id] ? 'visibility_off' : 'visibility'}
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Action Buttons */}
                  {!isDefault && (
                    <div className="flex flex-col gap-2">
                      {/* Show Models Button - only if we have a real API key */}
                      {apiKey && !apiKey.startsWith('$') && (
                        <button
                          onClick={() => setModelsModalProvider(provider.id)}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-lg text-xs text-blue-400 transition-colors w-full"
                        >
                          <span className="material-symbols-outlined text-[14px]">view_list</span>
                          View Models
                        </button>
                      )}
                      {/* Test API Key Button - only if we have a real API key (not env var ref) */}
                      {apiKey && !apiKey.startsWith('$') && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleTestApiKey(provider.id)}
                            disabled={testingProvider === provider.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600 rounded-lg text-xs text-slate-300 transition-colors disabled:opacity-50"
                          >
                            {testingProvider === provider.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <span className="material-symbols-outlined text-[14px]">quiz</span>
                            )}
                            Test 2+3
                          </button>
                          {testResults[provider.id] && (
                            <div className={`flex items-center gap-1 text-xs ${testResults[provider.id]?.success ? 'text-green-400' : 'text-red-400'}`}>
                              <span className="material-symbols-outlined text-[14px]">
                                {testResults[provider.id]?.success ? 'check_circle' : 'error'}
                              </span>
                              {testResults[provider.id]?.success
                                ? `${testResults[provider.id]?.latencyMs}ms`
                                : testResults[provider.id]?.error}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Agent Configuration by Category */}
      <section className="mb-12">
        <h2 className="text-white text-2xl font-bold mb-6 flex items-center gap-3">
          Model Assignments
          <div className="h-px flex-1 bg-slate-700" />
        </h2>

        <div className="space-y-8">
          {AGENT_CATEGORIES.map((category) => (
            <div key={category.name}>
              <div className="flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined text-slate-500 text-lg">{category.icon}</span>
                <h3 className="text-slate-300 font-semibold text-sm uppercase tracking-wider">{category.name}</h3>
                <div className="h-px flex-1 bg-slate-800" />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {category.agents.map((agent) => {
                  const currentModelId = (formData.models.overrides[agent.id] || DEFAULT_MODEL) as ModelId;
                  const modelDisplay = getModelDisplay(currentModelId);
                  const { score, matched, missing } = getCapabilityMatchScore(currentModelId, agent.id);
                  const requiredCaps = WORK_TYPE_CAPABILITIES[agent.id] || [];

                  // Determine fit quality (poor fit is implicit else case)
                  const isGoodFit = score >= 1;
                  const isOkFit = score >= 0.5 && score < 1;

                  // Build hover text
                  const hoverText = [
                    `${agent.name}: ${agent.description}`,
                    `Model: ${modelDisplay}`,
                    `Needs: ${requiredCaps.map(c => CAPABILITY_INFO[c].name).join(', ')}`,
                    matched.length > 0 ? `✓ Has: ${matched.map(c => CAPABILITY_INFO[c].name).join(', ')}` : '',
                    missing.length > 0 ? `✗ Missing: ${missing.map(c => CAPABILITY_INFO[c].name).join(', ')}` : '',
                  ].filter(Boolean).join('\n');

                  return (
                    <div
                      key={agent.id}
                      onClick={() => setModalWorkType(agent.id)}
                      title={hoverText}
                      className={`p-3 border rounded-lg cursor-pointer transition-all group ${
                        isGoodFit
                          ? 'bg-emerald-500/5 border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/10'
                          : isOkFit
                            ? 'bg-amber-500/5 border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/10'
                            : 'bg-rose-500/5 border-rose-500/30 hover:border-rose-500/50 hover:bg-rose-500/10'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`material-symbols-outlined text-sm ${
                          isGoodFit ? 'text-emerald-400' : isOkFit ? 'text-amber-400' : 'text-rose-400'
                        }`}>
                          {agent.icon}
                        </span>
                        <span className={`text-[9px] font-bold ${
                          isGoodFit ? 'text-emerald-400' : isOkFit ? 'text-amber-400' : 'text-rose-400'
                        }`}>
                          {Math.round(score * 100)}%
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-white truncate">{agent.name}</p>
                      <p className="text-[10px] text-slate-400 truncate mb-2">{modelDisplay}</p>

                      {/* Capability indicators */}
                      <div className="flex gap-1 flex-wrap">
                        {requiredCaps.slice(0, 3).map((cap: Capability) => {
                          const hasIt = matched.includes(cap);
                          return (
                            <span
                              key={cap}
                              title={`${CAPABILITY_INFO[cap].name}: ${hasIt ? 'Model has this' : 'Model missing this'}`}
                              className={`text-[8px] px-1 py-0.5 rounded ${
                                hasIt
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-rose-500/20 text-rose-400'
                              }`}
                            >
                              {CAPABILITY_INFO[cap].name}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-md border-t border-slate-700 px-6 py-4 z-40">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            {saveMutation.isSuccess && (
              <>
                <span className="material-symbols-outlined text-green-400">check_circle</span>
                <span className="text-green-400">Settings saved!</span>
              </>
            )}
            {saveMutation.isError && (
              <>
                <span className="material-symbols-outlined text-red-400">error</span>
                <span className="text-red-400">Error saving settings</span>
              </>
            )}
          </div>
          <div className="flex gap-4">
            <button
              onClick={handleRestoreOptimalDefaults}
              className="px-6 py-2 text-amber-400 hover:text-amber-300 font-semibold text-sm transition-colors flex items-center gap-1.5"
              title="Set all model assignments to research-based optimal defaults"
            >
              <span className="material-symbols-outlined text-[16px]">auto_fix_high</span>
              Optimal Defaults
            </button>
            <button
              onClick={handleReset}
              disabled={!hasChanges}
              className="px-6 py-2 text-slate-400 hover:text-white font-semibold text-sm transition-colors disabled:opacity-50"
            >
              Undo Changes
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending}
              className="px-8 py-2 bg-blue-500 hover:bg-blue-400 text-white font-black rounded-lg transition-all shadow-lg shadow-blue-500/20 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Changes
            </button>
          </div>
        </div>
      </footer>

      {/* Model Override Modal */}
      {modalWorkType && (
        <ModelOverrideModal
          workType={modalWorkType}
          currentModel={(formData.models.overrides[modalWorkType] || DEFAULT_MODEL) as ModelId}
          isOverride={!!formData.models.overrides[modalWorkType]}
          enabledProviders={Object.entries(formData.models.providers)
            .filter(([_, enabled]) => enabled)
            .map(([provider]) => provider)}
          onApply={(model) => handleSetOverride(modalWorkType, model)}
          onRemove={() => handleRemoveOverride(modalWorkType)}
          onClose={() => setModalWorkType(null)}
        />
      )}

      {/* Provider Models Modal */}
      {modelsModalProvider && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-blue-400">
                  {PROVIDERS.find(p => p.id === modelsModalProvider)?.icon}
                </span>
                <h3 className="text-white text-lg font-bold">
                  {PROVIDERS.find(p => p.id === modelsModalProvider)?.name} Models
                </h3>
              </div>
              <button
                onClick={() => setModelsModalProvider(null)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {(() => {
                const providerApiKey = formData?.api_keys[modelsModalProvider as keyof typeof formData.api_keys] || '';
                const isEnvVarRef = providerApiKey.startsWith('$');

                if (!providerApiKey) {
                  return (
                    <div className="text-center py-8">
                      <span className="material-symbols-outlined text-4xl text-slate-500 mb-2">key_off</span>
                      <p className="text-slate-400">Enter an API key to test models</p>
                    </div>
                  );
                }

                if (isEnvVarRef) {
                  return (
                    <div className="text-center py-8">
                      <span className="material-symbols-outlined text-4xl text-amber-500 mb-2">warning</span>
                      <p className="text-amber-400">API key configured via environment variable</p>
                      <p className="text-slate-500 text-sm mt-1">
                        <code className="font-mono bg-slate-800 px-1 rounded">{providerApiKey}</code> is not set
                      </p>
                      <p className="text-slate-500 text-xs mt-2">Set the environment variable or enter the key directly in Settings</p>
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
                        className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 hover:border-slate-600 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="material-symbols-outlined text-slate-400 text-sm">{model.icon}</span>
                              <h4 className="text-white font-semibold">{model.name}</h4>
                              {model.tier && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                  model.tier === 'premium' ? 'bg-purple-500/20 text-purple-400' :
                                  model.tier === 'balanced' ? 'bg-blue-500/20 text-blue-400' :
                                  'bg-emerald-500/20 text-emerald-400'
                                }`}>
                                  {model.tier}
                                </span>
                              )}
                            </div>
                            {model.description && (
                              <p className="text-xs text-slate-400 mb-2">{model.description}</p>
                            )}
                            <div className="flex flex-wrap gap-1">
                              {model.capabilities.map((cap) => (
                                <span
                                  key={cap}
                                  className="text-[9px] px-1.5 py-0.5 bg-slate-700/50 text-slate-400 rounded"
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
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-lg text-xs text-emerald-400 transition-colors disabled:opacity-50 whitespace-nowrap"
                            >
                              {isTesting ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                              )}
                              Test 2+3
                            </button>
                            {testResult && (
                              <div className={`flex items-center gap-1 text-xs ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
                                <span className="material-symbols-outlined text-[12px]">
                                  {testResult.success ? 'check_circle' : 'error'}
                                </span>
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

            {/* Footer */}
            <div className="p-4 border-t border-slate-700 bg-slate-900/50">
              <p className="text-xs text-slate-500 text-center">
                Test verifies API key and model availability by asking "What is 2+3?"
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
