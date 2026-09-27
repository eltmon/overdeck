import type { NormalizedOllamaConfig } from '../config-yaml/ollama.js';
import {
  checkOllamaHealth,
  ensureOllamaServeRunning,
  OllamaEnsureError,
  stripOllamaPrefix,
  warmOllamaModel,
} from '../ollama.js';

/**
 * Preflight a local Ollama model and return the env that points claude-code at it.
 *
 * The order matters: probe once, start `ollama serve` only if nothing answered, re-probe,
 * then refuse the launch unless the server is new enough AND has the tag. Every refusal
 * names the fix, because this message is what the operator sees instead of an agent.
 *
 * The context pins come from warm-loading the tag and asking the server what window it
 * actually gave it — never from config. The pin has to describe the window the harness
 * really gets, or Claude Code lets the conversation grow past it and Ollama truncates in
 * silence (PAN-1641 hazard H1).
 */
export async function getOllamaLaunchEnv(
  model: string,
  ollama: NormalizedOllamaConfig,
): Promise<Record<string, string>> {
  const tag = stripOllamaPrefix(model);

  let health = await checkOllamaHealth(tag, ollama.baseUrl);
  if (!health.endpointReachable) {
    await startOllamaOrExplain(ollama);
    health = await checkOllamaHealth(tag, ollama.baseUrl);
  }

  if (!health.endpointReachable || !health.versionSupported || !health.modelPresent) {
    throw new Error(health.message ?? `Ollama model ${tag} is unavailable at ${ollama.baseUrl}.`);
  }

  const { contextLength } = await warmOllamaModel(tag, ollama.baseUrl);

  return {
    ANTHROPIC_BASE_URL: ollama.baseUrl,
    ANTHROPIC_AUTH_TOKEN: 'ollama',
    // One local model serves every tier and every subagent: there is no cheaper
    // sibling to route haiku-class work to.
    ANTHROPIC_DEFAULT_OPUS_MODEL: tag,
    ANTHROPIC_DEFAULT_SONNET_MODEL: tag,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: tag,
    ANTHROPIC_SMALL_FAST_MODEL: tag,
    CLAUDE_CODE_SUBAGENT_MODEL: tag,
    // A 12B model on one consumer GPU is far slower per turn than a cloud endpoint.
    API_TIMEOUT_MS: '600000',
    // The point of a local model is that no prompt leaves the machine. Note this only
    // disables Claude Code's own nonessential traffic; configured remote MCP servers are
    // a separate egress path the harness still opens (PAN-1641 audit).
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(contextLength),
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(contextLength),
  };
}

/**
 * `ensureOllamaServeRunning` reports its own deadline failures, but a missing binary
 * surfaces as a raw `spawn ollama ENOENT` from the child process. Name the fix instead.
 */
async function startOllamaOrExplain(ollama: NormalizedOllamaConfig): Promise<void> {
  try {
    await ensureOllamaServeRunning({
      baseUrl: ollama.baseUrl,
      contextLength: ollama.contextLength,
      knownUnhealthy: true,
    });
  } catch (cause) {
    if (cause instanceof OllamaEnsureError) throw cause;
    throw new Error(
      `Ollama could not be started at ${ollama.baseUrl}. Install it from https://ollama.com/download, ` +
        'then run `ollama serve`.',
      { cause },
    );
  }
}
