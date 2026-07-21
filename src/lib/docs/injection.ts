import type { NormalizedDocsConfig } from '../config-yaml.js';
import type { DocsPathOverrides } from '../paths.js';
import { formatDocsQueryMarkdown, queryDocsIndex } from './query.js';
import {
  evaluateDocsPromptGate,
  recordDocsInjection,
  recordDocsTelemetry,
  type DocsGateReason,
  type DocsHookPayload,
} from './state.js';

export interface DocsInjectionOptions extends DocsHookPayload {
  config?: Pick<NormalizedDocsConfig, 'enabled' | 'promptInjectionEnabled' | 'trigger' | 'budget'>;
  paths?: DocsPathOverrides;
  now?: Date;
  signal?: AbortSignal;
}

export interface DocsInjectionResult {
  injected: boolean;
  context: string | null;
  reason?: DocsGateReason;
}

export async function buildDocsInjectionContext(options: DocsInjectionOptions): Promise<DocsInjectionResult> {
  try {
    if (options.signal?.aborted) return { injected: false, context: null };
    const gate = await evaluateDocsPromptGate({
      payload: {
        prompt: options.prompt,
        sessionId: options.sessionId,
        projectPath: options.projectPath,
      },
      config: options.config,
      paths: options.paths,
      now: options.now,
    });

    if (!gate.shouldInject) {
      return { injected: false, context: null, reason: gate.reason };
    }
    if (options.signal?.aborted) return { injected: false, context: null };

    const result = queryDocsIndex({
      query: options.prompt,
      config: options.config,
      indexPath: options.paths?.indexPath,
    });

    if (result.results.length === 0) {
      return { injected: false, context: null };
    }
    if (options.signal?.aborted) return { injected: false, context: null };

    const injectedTokens = result.results.reduce((total, item) => total + item.tokenCount, 0);
    await recordDocsInjection({
      budgetKey: gate.budgetKey,
      tokens: injectedTokens,
      paths: options.paths,
      now: options.now,
    });
    await recordDocsTelemetry({
      queryCount: 1,
      injectedTokens,
      hit: true,
      matched: gate.matched,
      budgetKey: gate.budgetKey,
      chunkCount: result.results.length,
      paths: options.paths,
      now: options.now,
    });

    return { injected: true, context: formatDocsQueryMarkdown(result) };
  } catch {
    return { injected: false, context: null };
  }
}
