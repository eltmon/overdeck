import type { NormalizedConfig } from './config-yaml/schema.js';
import { OLLAMA_MODEL_PREFIX } from './ollama.js';

/**
 * Every distinct `ollama:<tag>` model id the merged config names, across workhorse slots,
 * role models (scalar or distribution), autonomous role models, and sub-role models.
 *
 * Callers use this to decide whether a local Ollama server is part of this install at all —
 * `pan up` starts `ollama serve` only when this list is non-empty, and `pan doctor` reports
 * Ollama only when it has something to report on. Kept as a pure function in its own module
 * so config-yaml can stay out of the import graph of its callers.
 */
export function configuredOllamaModels(config: NormalizedConfig): string[] {
  const found = new Set<string>();

  for (const ref of Object.values(config.workhorses ?? {})) {
    addIfOllama(found, ref);
  }

  for (const role of Object.values(config.roles ?? {})) {
    if (!role) continue;
    if (Array.isArray(role.model)) {
      for (const entry of role.model) addIfOllama(found, entry?.model);
    } else {
      addIfOllama(found, role.model);
    }
    addIfOllama(found, role.autonomousModel);
    for (const sub of Object.values(role.sub ?? {})) {
      addIfOllama(found, sub?.model);
    }
  }

  return [...found];
}

function addIfOllama(found: Set<string>, ref: unknown): void {
  if (typeof ref === 'string' && ref.startsWith(OLLAMA_MODEL_PREFIX)) found.add(ref);
}
