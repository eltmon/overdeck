/**
 * PAN-3842: the providers an operator can actually enable.
 *
 * `models.providers` in config.yaml and Settings › Providers both accept
 * exactly these ids. `PROVIDERS` in `src/lib/providers.ts` is a larger set —
 * it also carries providers reachable only through environment variables
 * (xai, groq, cerebras, mistral, quantumllama), which have no YAML key, no
 * merge branch that can put them in `enabledProviders`, and no Settings
 * toggle.
 *
 * The fitness checker's `provider-not-enabled` warning must be scoped to this
 * set. Pointing an operator at "Settings › Providers" for a provider with no
 * control there produces a warning that no action can clear.
 *
 * This is a plain table with no imports so both the server schema and the
 * dashboard bundle can derive their `Provider` unions from it — one source of
 * truth instead of two hand-maintained type literals that can drift apart.
 */
export const CONFIGURABLE_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'minimax',
  'zai',
  'kimi',
  'mimo',
  'openrouter',
  'nous',
  'dashscope',
  'meta',
  'opencode',
  'opencode-go',
] as const;

export type ConfigurableProvider = (typeof CONFIGURABLE_PROVIDERS)[number];

export const CONFIGURABLE_PROVIDER_SET: ReadonlySet<string> = new Set(CONFIGURABLE_PROVIDERS);
