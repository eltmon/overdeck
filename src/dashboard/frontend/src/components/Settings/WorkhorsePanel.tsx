import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';

const WORKHORSE_SLOTS = [
  {
    id: 'expensive',
    label: 'Expensive',
    description: 'Strongest, costly — plan/review default',
  },
  {
    id: 'mid',
    label: 'Mid',
    description: 'Balanced default',
  },
  {
    id: 'cheap',
    label: 'Cheap',
    description: 'Fast & cheap — universal inspect',
  },
] as const;

type WorkhorseSlot = typeof WORKHORSE_SLOTS[number]['id'];
type WorkhorsesConfig = Record<WorkhorseSlot, string>;

interface SettingsResponse {
  workhorses?: Partial<WorkhorsesConfig>;
  models?: {
    providers?: Partial<Record<string, boolean>>;
  };
}

interface AvailableModel {
  id: string;
  name: string;
  costPer1MTokens: number;
}

type AvailableModelsResponse = Record<string, AvailableModel[]>;

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  minimax: 'MiniMax',
  zai: 'Z.AI',
  glm: 'Z.AI',
  kimi: 'Kimi',
  mimo: 'MiMo',
  nous: 'Nous Portal',
  openrouter: 'OpenRouter',
};

async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

async function fetchAvailableModels(): Promise<AvailableModelsResponse> {
  const res = await fetch('/api/settings/available-models');
  if (!res.ok) throw new Error('Failed to fetch available models');
  return res.json();
}

function providerForModel(modelId: string, groups: Array<{ provider: string; models: AvailableModel[] }>): string | null {
  return groups.find((group) => group.models.some((model) => model.id === modelId))?.provider ?? null;
}

function providerWarning(
  modelId: string | undefined,
  groups: Array<{ provider: string; label: string; models: AvailableModel[] }>,
  providers: Partial<Record<string, boolean>> | undefined,
): string | null {
  if (!modelId) return null;
  const provider = providerForModel(modelId, groups);
  if (!provider) return null;
  const label = PROVIDER_LABELS[provider] ?? provider;
  if (providers?.[provider] === false) return `${label} is not configured; roles using this workhorse will not be reachable until the provider is enabled with credentials.`;
  if (provider === 'anthropic') return 'Anthropic model selected; roles using this workhorse may incur Anthropic spend.';
  return null;
}

async function saveWorkhorse(slot: WorkhorseSlot, modelId: string): Promise<void> {
  const settings = await fetchSettings();
  const nextSettings = {
    ...settings,
    workhorses: {
      ...(settings.workhorses ?? {}),
      [slot]: modelId,
    },
  };

  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(nextSettings),
  });
  if (!res.ok) {
    const message = await res.text().catch(() => 'Failed to save workhorse model');
    throw new Error(message || 'Failed to save workhorse model');
  }
}

export function WorkhorsePanel() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    staleTime: 60000,
  });
  const availableModelsQuery = useQuery({
    queryKey: ['available-models'],
    queryFn: fetchAvailableModels,
    staleTime: 60000,
  });

  const saveMutation = useMutation({
    mutationFn: ({ slot, modelId }: { slot: WorkhorseSlot; modelId: string }) => saveWorkhorse(slot, modelId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Workhorse model updated');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update workhorse model: ${error.message}`);
    },
  });

  const workhorses = settingsQuery.data?.workhorses ?? {};
  const providerGroups = Object.entries(availableModelsQuery.data ?? {})
    .filter(([, models]) => Array.isArray(models) && models.length > 0)
    .map(([provider, models]) => ({
      provider,
      label: PROVIDER_LABELS[provider] ?? provider,
      models,
    }));

  const loading = settingsQuery.isLoading || availableModelsQuery.isLoading;

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Zap className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Workhorse Models</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Set the three model slots that roles reference with workhorse:&lt;slot&gt;.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading workhorse models…
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {WORKHORSE_SLOTS.map((slot) => {
            const value = workhorses[slot.id];
            const warning = providerWarning(value, providerGroups, settingsQuery.data?.models?.providers);

            return (
            <label key={slot.id} className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">{slot.label}</span>
              <select
                aria-label={slot.label}
                value={value ?? ''}
                onChange={(event) => saveMutation.mutate({ slot: slot.id, modelId: event.target.value })}
                disabled={saveMutation.isPending || providerGroups.length === 0}
                className="w-full px-3 py-2 bg-popover border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              >
                {!value && <option value="">Select a model…</option>}
                {providerGroups.map((group) => (
                  <optgroup key={group.provider} label={group.label}>
                    {group.models.map((model) => (
                      <option key={`${group.provider}:${model.id}`} value={model.id}>
                        {group.label} &gt; {model.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="text-[11px] leading-snug text-muted-foreground">{slot.description}</p>
              {warning && (
                <p className="text-[11px] leading-snug text-warning" role="alert">
                  {warning}
                </p>
              )}
            </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
