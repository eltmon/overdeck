#!/usr/bin/env tsx
/**
 * PAN-1570 backfill: reconstruct cost events dropped while the cost hook was
 * silently broken (Effect-migration regression, 2026-05-21 → fix date).
 *
 * Reads Claude Code transcripts under ~/.claude/projects, recomputes cost with
 * the project's OWN pricing (getPricingSync/calculateCostSync) so numbers match
 * live events exactly, dedupes by requestId against the existing events.jsonl,
 * and appends reconstructed events (marked `backfilled: true`) to events.jsonl.
 *
 * Run dry:   npx tsx scripts/backfill-costs-pan1570.mts
 * Run write: npx tsx scripts/backfill-costs-pan1570.mts --write
 */
import { readdirSync, readFileSync, existsSync, statSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getPricingSync, calculateCostSync, type AIProvider } from '../src/lib/cost.js';

const WRITE = process.argv.includes('--write');
const CUTOFF = '2026-05-21T00:00:00'; // gap start (last good event was 2026-05-21)
const PROJECTS = join(homedir(), '.claude', 'projects');
const EVENTS = join(homedir(), '.overdeck', 'costs', 'events.jsonl');

function providerFor(model: string): AIProvider {
  if (model.includes('gpt')) return 'openai';
  if (model.includes('gemini')) return 'google';
  if (model.includes('kimi') || model.toLowerCase().startsWith('minimax')) return 'custom';
  return 'anthropic';
}
function inferIssue(dir: string): string {
  const m = dir.match(/(pan|min|aud|krux|cli)[-](\d+)/i);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : 'UNKNOWN';
}
function* walk(dir: string): Generator<string> {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* walk(p);
    else if (e.endsWith('.jsonl')) yield p;
  }
}

// Existing requestIds (dedup)
const seen = new Set<string>();
if (existsSync(EVENTS)) {
  for (const line of readFileSync(EVENTS, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line); if (e.requestId) seen.add(e.requestId); } catch { /* skip */ }
  }
}
const preexisting = seen.size;

let added = 0, totalCost = 0, scanned = 0, noPrice = 0;
const byModel: Record<string, { n: number; cost: number }> = {};
const skippedModels: Record<string, number> = {};
const out: string[] = [];

for (const dir of readdirSync(PROJECTS)) {
  const issueId = inferIssue(dir);
  for (const file of walk(join(PROJECTS, dir))) {
    let content: string;
    try { content = readFileSync(file, 'utf-8'); } catch { continue; }
    const sessionId = file.split('/').pop()!.replace('.jsonl', '');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let entry: any;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type !== 'assistant' || !entry.message?.usage) continue;
      const ts: string = entry.timestamp || '';
      if (ts < CUTOFF) continue;
      const requestId: string | undefined = entry.requestId;
      if (requestId) { if (seen.has(requestId)) continue; seen.add(requestId); }
      scanned++;
      const u = entry.message.usage;
      const input = u.input_tokens || 0, output = u.output_tokens || 0;
      const cacheRead = u.cache_read_input_tokens || 0, cacheWrite = u.cache_creation_input_tokens || 0;
      if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) continue;
      const model: string = entry.message.model || 'claude-sonnet-4';
      if (model === '<synthetic>') continue;
      const provider = providerFor(model);
      const pricing = getPricingSync(provider, model);
      if (!pricing) { noPrice++; skippedModels[model] = (skippedModels[model] || 0) + 1; continue; }
      const cost = calculateCostSync({ inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, cacheTTL: '5m' }, pricing);
      const ev = {
        ts, type: 'cost', agentId: 'backfill', issueId, sessionType: 'implementation',
        provider, model, input, output, cacheRead, cacheWrite, cost,
        ...(requestId ? { requestId } : {}), sessionId, backfilled: true,
      };
      out.push(JSON.stringify(ev));
      added++; totalCost += cost;
      byModel[model] = byModel[model] || { n: 0, cost: 0 };
      byModel[model].n++; byModel[model].cost += cost;
    }
  }
}

if (WRITE && out.length) appendFileSync(EVENTS, out.join('\n') + '\n', 'utf-8');

console.log(`mode:        ${WRITE ? 'WRITE' : 'DRY-RUN'}`);
console.log(`cutoff:      ${CUTOFF}`);
console.log(`preexisting requestIds in events.jsonl: ${preexisting}`);
console.log(`new events:  ${added}  (scanned ${scanned} candidate assistant msgs)`);
console.log(`total cost:  $${totalCost.toFixed(2)}`);
console.log(`unpriced skipped: ${noPrice}  models: ${JSON.stringify(skippedModels)}`);
console.log('by model:');
for (const [m, v] of Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost)) {
  console.log(`  ${m.padEnd(34)} ${String(v.n).padStart(7)} msgs  $${v.cost.toFixed(2)}`);
}
