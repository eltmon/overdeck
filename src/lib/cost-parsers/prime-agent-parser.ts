export interface PrimeAgentUsageInput {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
  cost?: number;
  contextWindow?: number;
}

export interface PrimeAgentUsageRecord extends PrimeAgentUsageInput {
  contextPercent?: number;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function mapPrimeAgentSessionStats(stats: Record<string, unknown>): PrimeAgentUsageRecord {
  const tokens = stats.tokens && typeof stats.tokens === 'object' ? stats.tokens as Record<string, unknown> : stats;
  const input = finite(tokens.input ?? tokens.inputTokens);
  const output = finite(tokens.output ?? tokens.outputTokens);
  const cacheRead = finite(tokens.cacheRead ?? tokens.cache_read ?? tokens.cacheReadTokens);
  const cacheWrite = finite(tokens.cacheWrite ?? tokens.cache_write ?? tokens.cacheWriteTokens);
  const total = finite(tokens.total ?? tokens.totalTokens);
  const cost = finite(stats.cost ?? stats.totalCost);
  const contextWindow = finite(stats.contextWindow ?? stats.context_window);
  const contextUsed = finite(stats.contextUsed ?? stats.context_used) ?? (input !== undefined && output !== undefined ? input + output : undefined);
  return {
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(cost !== undefined ? { cost } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(contextWindow && contextUsed !== undefined ? { contextPercent: contextUsed / contextWindow * 100 } : {}),
  };
}

export function parsePrimeAgentSessionContent(content: string): PrimeAgentUsageRecord {
  const totals: PrimeAgentUsageRecord = {};
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (record.type !== 'assistant' && record.type !== 'session_stats') continue;
      const mapped = mapPrimeAgentSessionStats(record.usage && typeof record.usage === 'object' ? record.usage as Record<string, unknown> : record);
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total', 'cost'] as const) {
        if (mapped[key] !== undefined) totals[key] = (totals[key] ?? 0) + mapped[key]!;
      }
      if (mapped.contextWindow !== undefined) totals.contextWindow = mapped.contextWindow;
      if (mapped.contextPercent !== undefined) totals.contextPercent = mapped.contextPercent;
    } catch { /* Ignore partial trailing records. */ }
  }
  return totals;
}
