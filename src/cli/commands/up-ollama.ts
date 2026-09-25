import chalk from 'chalk';

import type { NormalizedConfig } from '../../lib/config-yaml/schema.js';
import { configuredOllamaModels } from '../../lib/ollama-usage.js';
import { checkOllamaHealth, ensureOllamaServeRunning } from '../../lib/ollama.js';

export type EnsureOllamaForUpResult = 'not-configured' | 'running' | 'started' | 'failed';

export interface EnsureOllamaForUpDeps {
  checkHealth?: typeof checkOllamaHealth;
  ensureServe?: typeof ensureOllamaServeRunning;
  log?: (line: string) => void;
}

/**
 * Bring up the local Ollama server as part of `pan up`, but only for an install that
 * actually uses one: with no `ollama:` model in the config this makes no network call
 * at all, so the overwhelming majority of hosts pay nothing for the feature.
 *
 * It never throws. A local model server that will not start is a reason to tell the
 * operator, not a reason to refuse to start Overdeck — every cloud-model agent on the
 * host is unaffected.
 */
export async function ensureOllamaForUp(
  config: NormalizedConfig,
  deps: EnsureOllamaForUpDeps = {},
): Promise<EnsureOllamaForUpResult> {
  const models = configuredOllamaModels(config);
  if (models.length === 0) return 'not-configured';

  const log = deps.log ?? ((line: string) => console.log(line));
  const { baseUrl, contextLength } = config.ollama;
  const checkHealth = deps.checkHealth ?? checkOllamaHealth;
  const ensureServe = deps.ensureServe ?? ensureOllamaServeRunning;

  try {
    const health = await checkHealth(models[0], baseUrl);
    if (health.endpointReachable) {
      log(chalk.green(`✓ Ollama running at ${baseUrl}`));
      return 'running';
    }

    await ensureServe({ baseUrl, contextLength, knownUnhealthy: true });
    log(chalk.green(`✓ Ollama started at ${baseUrl}`));
    return 'started';
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(chalk.yellow(`Warning: could not start Ollama at ${baseUrl}: ${reason}`));
    log(chalk.dim('  Agents on cloud models are unaffected; local models will fail to launch until it is up.'));
    return 'failed';
  }
}
