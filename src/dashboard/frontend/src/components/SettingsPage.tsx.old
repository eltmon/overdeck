import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Save, X, Eye, EyeOff, Loader2 } from 'lucide-react';

// Settings data types (matches backend SettingsConfig)
interface SpecialistModels {
  review_agent: string;
  test_agent: string;
  merge_agent: string;
}

interface ComplexityModels {
  trivial: string;
  simple: string;
  medium: string;
  complex: string;
  expert: string;
}

interface ModelsConfig {
  specialists: SpecialistModels;
  planning_agent: string;
  complexity: ComplexityModels;
}

interface ApiKeysConfig {
  openai?: string;
  google?: string;
  zai?: string;
}

interface SettingsConfig {
  models: ModelsConfig;
  api_keys: ApiKeysConfig;
}

// Available models by provider
interface AvailableModels {
  anthropic: string[];
  openai: string[];
  google: string[];
  zai: string[];
}

// Fetch current settings
async function fetchSettings(): Promise<SettingsConfig> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

// Fetch available models (filtered by configured API keys)
async function fetchAvailableModels(): Promise<AvailableModels> {
  const res = await fetch('/api/settings/available-models');
  if (!res.ok) throw new Error('Failed to fetch available models');
  return res.json();
}

// Save settings
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

export function SettingsPage() {
  const queryClient = useQueryClient();

  // Fetch settings and available models
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  const { data: availableModels } = useQuery({
    queryKey: ['available-models'],
    queryFn: fetchAvailableModels,
  });

  // Form state
  const [formData, setFormData] = useState<SettingsConfig | null>(null);
  const [showApiKeys, setShowApiKeys] = useState({
    openai: false,
    google: false,
    zai: false,
  });

  // Initialize form data when settings load
  useEffect(() => {
    if (settings && !formData) {
      setFormData(settings);
    }
  }, [settings, formData]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['available-models'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400">Error: {(error as Error).message}</div>
      </div>
    );
  }

  if (!formData) {
    return null;
  }

  // Get all models grouped by provider
  const allModels = availableModels || {
    anthropic: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    openai: [],
    google: [],
    zai: [],
  };

  // Flatten all models for dropdowns
  const modelOptions = [
    ...allModels.anthropic.map(m => ({ value: m, label: m, provider: 'Anthropic' })),
    ...allModels.openai.map(m => ({ value: m, label: m, provider: 'OpenAI' })),
    ...allModels.google.map(m => ({ value: m, label: m, provider: 'Google' })),
    ...allModels.zai.map(m => ({ value: m, label: m, provider: 'Z.AI' })),
  ];

  const hasChanges = JSON.stringify(formData) !== JSON.stringify(settings);

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Settings className="w-6 h-6" />
            System Settings
          </h1>
          <p className="text-gray-400 mt-1">
            Configure AI model orchestration, task complexity thresholds, and API integrations.
          </p>
        </div>
      </div>

      {/* Specialist Agent Models */}
      <section className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4">Specialist Agent Models</h2>
        <p className="text-sm text-gray-400 mb-6">
          Select models for code review, testing, and merge specialist agents.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Review Agent
            </label>
            <select
              value={formData.models.specialists.review_agent}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  models: {
                    ...formData.models,
                    specialists: {
                      ...formData.models.specialists,
                      review_agent: e.target.value,
                    },
                  },
                })
              }
              className="w-full bg-gray-900 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} ({opt.provider})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Test Agent
            </label>
            <select
              value={formData.models.specialists.test_agent}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  models: {
                    ...formData.models,
                    specialists: {
                      ...formData.models.specialists,
                      test_agent: e.target.value,
                    },
                  },
                })
              }
              className="w-full bg-gray-900 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} ({opt.provider})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Merge Agent
            </label>
            <select
              value={formData.models.specialists.merge_agent}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  models: {
                    ...formData.models,
                    specialists: {
                      ...formData.models.specialists,
                      merge_agent: e.target.value,
                    },
                  },
                })
              }
              className="w-full bg-gray-900 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} ({opt.provider})
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Planning Agent Model */}
      <section className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4">Planning Agent Model</h2>
        <p className="text-sm text-gray-400 mb-6">
          Model used for autonomous planning and architectural decisions.
        </p>
        <div className="max-w-md">
          <select
            value={formData.models.planning_agent}
            onChange={(e) =>
              setFormData({
                ...formData,
                models: {
                  ...formData.models,
                  planning_agent: e.target.value,
                },
              })
            }
            className="w-full bg-gray-900 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {modelOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} ({opt.provider})
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Task Complexity Models */}
      <section className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4">Task Complexity Models</h2>
        <p className="text-sm text-gray-400 mb-6">
          Map task complexity levels to appropriate AI models for cost optimization.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
          {(['trivial', 'simple', 'medium', 'complex', 'expert'] as const).map((level) => (
            <div key={level}>
              <label className="block text-sm font-medium text-gray-300 mb-2 capitalize">
                {level}
              </label>
              <select
                value={formData.models.complexity[level]}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    models: {
                      ...formData.models,
                      complexity: {
                        ...formData.models.complexity,
                        [level]: e.target.value,
                      },
                    },
                  })
                }
                className="w-full bg-gray-900 border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {modelOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      {/* API Keys */}
      <section className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4">API Keys</h2>
        <p className="text-sm text-gray-400 mb-6">
          Configure API keys for external model providers. Leave blank to use environment variables.
        </p>
        <div className="space-y-4 max-w-2xl">
          {/* OpenAI */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              OpenAI API Key
            </label>
            <div className="relative">
              <input
                type={showApiKeys.openai ? 'text' : 'password'}
                value={formData.api_keys.openai || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    api_keys: {
                      ...formData.api_keys,
                      openai: e.target.value || undefined,
                    },
                  })
                }
                placeholder="sk-... or $OPENAI_API_KEY"
                className="w-full bg-gray-900 border border-gray-600 rounded-md px-3 py-2 pr-10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowApiKeys({ ...showApiKeys, openai: !showApiKeys.openai })}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                {showApiKeys.openai ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Google */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Google AI API Key
            </label>
            <div className="relative">
              <input
                type={showApiKeys.google ? 'text' : 'password'}
                value={formData.api_keys.google || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    api_keys: {
                      ...formData.api_keys,
                      google: e.target.value || undefined,
                    },
                  })
                }
                placeholder="AIza... or $GOOGLE_AI_API_KEY"
                className="w-full bg-gray-900 border border-gray-600 rounded-md px-3 py-2 pr-10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowApiKeys({ ...showApiKeys, google: !showApiKeys.google })}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                {showApiKeys.google ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Z.AI */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Z.AI API Key
            </label>
            <div className="relative">
              <input
                type={showApiKeys.zai ? 'text' : 'password'}
                value={formData.api_keys.zai || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    api_keys: {
                      ...formData.api_keys,
                      zai: e.target.value || undefined,
                    },
                  })
                }
                placeholder="... or $ZAI_API_KEY"
                className="w-full bg-gray-900 border border-gray-600 rounded-md px-3 py-2 pr-10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowApiKeys({ ...showApiKeys, zai: !showApiKeys.zai })}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                {showApiKeys.zai ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-4">
        <button
          onClick={() => setFormData(settings || null)}
          disabled={!hasChanges}
          className="px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <X className="w-4 h-4" />
          Discard Changes
        </button>
        <button
          onClick={() => formData && saveMutation.mutate(formData)}
          disabled={!hasChanges || saveMutation.isPending}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Changes
            </>
          )}
        </button>
      </div>

      {/* Save status */}
      {saveMutation.isSuccess && (
        <div className="bg-green-900/30 border border-green-700 rounded-md p-4 text-green-400">
          Settings saved successfully! Changes will apply to newly spawned agents.
        </div>
      )}
      {saveMutation.isError && (
        <div className="bg-red-900/30 border border-red-700 rounded-md p-4 text-red-400">
          Error: {(saveMutation.error as Error).message}
        </div>
      )}
    </div>
  );
}
