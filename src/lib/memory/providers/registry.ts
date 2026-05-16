import { loadMemorySettings } from '../settings.js';
import { AnthropicExtractionProvider } from './anthropic.js';
import { CliproxyExtractionProvider } from './cliproxy.js';
import type {
  ExtractionProvider,
  ExtractionProviderSelection,
  ExtractionProviderTarget,
  MemoryProviderSettings,
} from './types.js';

const DEFAULT_PROVIDER = 'anthropic';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const registry = new Map<string, ExtractionProvider>();

registerExtractionProvider(new AnthropicExtractionProvider());
registerExtractionProvider(new CliproxyExtractionProvider());

export function registerExtractionProvider(provider: ExtractionProvider): void {
  registry.set(provider.name, provider);
}

export function getExtractionProvider(name: string): ExtractionProvider {
  const provider = registry.get(name);
  if (!provider) throw new Error(`Unknown extraction provider: ${name}`);
  return provider;
}

export function listExtractionProviders(): ExtractionProvider[] {
  return [...registry.values()];
}

export async function resolveExtractionProviderSelection(
  settings: MemoryProviderSettings | null = null,
): Promise<ExtractionProviderSelection> {
  const envProvider = normalizeEnv(process.env.PANOPTICON_MEMORY_PROVIDER);
  const envModel = normalizeEnv(process.env.PANOPTICON_MEMORY_MODEL);
  if (envProvider || envModel) {
    const provider = envProvider ?? settings?.provider ?? DEFAULT_PROVIDER;
    return {
      provider,
      model: envModel ?? settings?.model ?? getProviderDefaultModel(provider),
      fallbackChain: settings?.fallbackChain ?? [],
      source: 'env',
    };
  }

  const effectiveSettings = settings ?? await loadMemoryProviderSettings();
  if (effectiveSettings?.provider || effectiveSettings?.model) {
    const provider = effectiveSettings.provider ?? DEFAULT_PROVIDER;
    return {
      provider,
      model: effectiveSettings.model ?? getProviderDefaultModel(provider),
      fallbackChain: effectiveSettings.fallbackChain ?? [],
      source: 'settings',
    };
  }

  return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, fallbackChain: [], source: 'default' };
}

export async function resolveExtractionProvider(
  settings: MemoryProviderSettings | null = null,
): Promise<{ provider: ExtractionProvider; model: string; fallbackChain: ExtractionProviderTarget[]; source: ExtractionProviderSelection['source'] }> {
  const selection = await resolveExtractionProviderSelection(settings);
  return {
    provider: getExtractionProvider(selection.provider),
    model: selection.model,
    fallbackChain: selection.fallbackChain,
    source: selection.source,
  };
}

async function loadMemoryProviderSettings(): Promise<MemoryProviderSettings | null> {
  const settings = await loadMemorySettings();
  return settings.extraction;
}

function getProviderDefaultModel(providerName: string): string {
  return registry.get(providerName)?.defaultModel ?? DEFAULT_MODEL;
}

function normalizeEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
