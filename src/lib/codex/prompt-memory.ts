/**
 * Per-turn memory for Codex app-server turns (PAN-5359). The host asks the
 * dashboard's `/api/memory/inject` (the same route the Claude hooks call, so
 * identity, briefing, docs and rag-runs logging are shared) and wraps the
 * answer in front of the prompt. Fails open: any miss returns the prompt.
 */
import { getDashboardLoopbackApiUrl } from '../config.js';
import { getInternalToken, INTERNAL_TOKEN_HEADER } from '../internal-token.js';
import { wrapCodexTurnContext } from '../codex-rollout-message.js';

export const CODEX_PROMPT_MEMORY_TIMEOUT_MS = 1500;

export interface CodexPromptMemoryInput {
  prompt: string;
  agentId: string;
  sessionId: string;
  conversation?: string;
}

export interface CodexPromptMemoryDeps {
  fetchImpl?: typeof fetch;
  token?: () => string | null;
  baseUrl?: () => string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface CodexPromptMemoryResult {
  text: string;
  contextChars: number;
}

export async function applyCodexPromptMemory(
  input: CodexPromptMemoryInput,
  deps: CodexPromptMemoryDeps = {},
): Promise<CodexPromptMemoryResult> {
  const unchanged = { text: input.prompt, contextChars: 0 };
  const env = deps.env ?? process.env;
  if (!input.prompt.trim() || env.OVERDECK_BARE_CONTEXT === '1') return unchanged;
  const token = (deps.token ?? getInternalToken)();
  if (!token) return unchanged;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? CODEX_PROMPT_MEMORY_TIMEOUT_MS);
  try {
    const baseUrl = deps.baseUrl ? deps.baseUrl() : (env.OVERDECK_DASHBOARD_URL || getDashboardLoopbackApiUrl());
    const response = await (deps.fetchImpl ?? fetch)(`${baseUrl}/api/memory/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: token },
      body: JSON.stringify({
        prompt: input.prompt,
        sessionId: input.sessionId,
        agentId: input.agentId,
        ...(input.conversation ? { conversation: input.conversation } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) return unchanged;
    const body = await response.json().catch(() => null) as { ok?: unknown; context?: unknown } | null;
    if (body?.ok !== true || typeof body.context !== 'string') return unchanged;
    const text = wrapCodexTurnContext(body.context, input.prompt);
    return text ? { text, contextChars: body.context.length } : unchanged;
  } catch {
    return unchanged;
  } finally {
    clearTimeout(timer);
  }
}
