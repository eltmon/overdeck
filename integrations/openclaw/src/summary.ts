/** The per-turn "needs you" summary for before_prompt_build (PAN-4954 WI-8, FR-5, D-9, D-10;
 * PAN-4927 W-INT2). It fetches at most once per SUMMARY_INTERVAL_MS per gateway process and adds
 * text only on the turn that fetched and found something, so the summary does not repeat. */
import type { McpClient } from './mcp-client.js';
import type { PluginLogger, PromptBuildHandler } from './openclaw-api.js';
import { parsePendingInput, summaryText } from './pending.js';

export const SUMMARY_INTERVAL_MS = 5 * 60_000;
export const SUMMARY_TIMEOUT_MS = 5_000;

export function createSummaryHook(input: { client: McpClient; logger: PluginLogger; now?: () => number }): PromptBuildHandler {
  const now = input.now ?? Date.now;
  let lastAttempt = -Infinity;

  return async () => {
    const t = now();
    if (t - lastAttempt < SUMMARY_INTERVAL_MS) return undefined;
    // Set before awaiting, so two turns that start together fetch once.
    lastAttempt = t;
    try {
      const result = await input.client.callTool('list_pending_input', {}, { timeoutMs: SUMMARY_TIMEOUT_MS });
      if (result.isError) return undefined;
      const text = summaryText(parsePendingInput(result.text));
      return text === null ? undefined : { prependContext: text };
    } catch (error) {
      input.logger.debug?.(`[overdeck] summary skipped: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };
}
