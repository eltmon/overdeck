import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { parseCodexSessionCostEventsSync, parseCodexSessionSync } from '../cost-parsers/codex-parser.js';
import { getOverdeckHome } from '../paths.js';
import type { IssueId } from '../overdeck/issues.js';
import { lookupSkipVerdict, type SkipVerdict } from './skip-cache.js';

export type SkipVerdictEntry = { path: string; mtimeMs: number; size: number; verdict: SkipVerdict };

type CollectedCostEvent = {
  ts: Date;
  issueId: IssueId | null;
  agentId: string | null;
  sessionId: string | null;
  sessionType: string | null;
  provider: string | null;
  model: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  requestId: string | null;
  sourceFile: string | null;
};

type CostReconcileExtraRoot =
  | { kind: 'codex-global'; root: string }
  | { kind: 'ohmypi-global'; root: string }
  | { kind: 'ohmypi-legacy-agents'; root: string };

type SkippedCostSession = { file: string; reason: string };

function walkJsonl(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walkJsonl(full) : entry.name.endsWith('.jsonl') ? [full] : [];
  });
}

function issueIdFromAgentName(name: string): IssueId | null {
  const match = name.match(/(?:agent|planning)-((?:[a-z]+-)?\d+)/i);
  return match?.[1] ? match[1].toUpperCase() as IssueId : null;
}

function inferIssueFromPath(path: string | undefined): IssueId | null {
  const match = path?.match(/(?:feature[-/]|workspaces\/feature-)([a-z]+-\d+)/i);
  return match?.[1] ? match[1].toUpperCase() as IssueId : null;
}

export async function collectCodexCostEvents(opts: {
  extraRoots?: string[];
  extraRootSpecs?: CostReconcileExtraRoot[];
} = {}) {
  const agentsDir = join(getOverdeckHome(), 'agents');
  const names = existsSync(agentsDir)
    ? readdirSync(agentsDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) : [];
  const roots = names.map(agentName => ({ root: join(agentsDir, agentName, 'codex-home', 'sessions'),
    agentName, issueId: issueIdFromAgentName(agentName), inferIssueFromCwd: false }));
  for (const root of opts.extraRoots ?? []) roots.push({ root, agentName: 'codex-global', issueId: null, inferIssueFromCwd: true });
  for (const extra of opts.extraRootSpecs ?? []) if (extra.kind === 'codex-global') {
    roots.push({ root: extra.root, agentName: 'codex-global', issueId: null, inferIssueFromCwd: true });
  }

  const events: CollectedCostEvent[] = [];
  const verdicts: SkipVerdictEntry[] = [];
  const skipped: SkippedCostSession[] = [];
  const errors: string[] = [];
  let scanned = 0;
  let cacheSkipped = 0;
  for (const root of roots) for (const file of walkJsonl(root.root)) {
    scanned++;
    const stat = statSync(file);
    if (lookupSkipVerdict(file, stat.mtimeMs, stat.size)) { cacheSkipped++; continue; }
    let parsed;
    try { parsed = parseCodexSessionCostEventsSync(file); }
    catch (cause) { errors.push(`${file}: ${cause instanceof Error ? cause.message : String(cause)}`); continue; }
    if (parsed.length === 0) {
      skipped.push({ file, reason: 'no-usage' });
      verdicts.push({ path: file, mtimeMs: stat.mtimeMs, size: stat.size, verdict: 'no-usage' });
      continue;
    }
    const unknown = parsed.some(event => event.model === 'unknown');
    if (unknown) skipped.push({ file, reason: 'unknown-model' });
    const session = root.inferIssueFromCwd ? parseCodexSessionSync(file) : null;
    const issueId = root.inferIssueFromCwd ? inferIssueFromPath(session?.cwd) ?? 'UNKNOWN' as IssueId : root.issueId;
    events.push(...parsed.map(usage => ({ ts: new Date(usage.timestamp), issueId, agentId: root.agentName,
      sessionId: usage.sessionId, sessionType: 'codex', provider: usage.provider, model: usage.model,
      input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
      cost: usage.cost, requestId: usage.requestId, sourceFile: file })));
    verdicts.push({ path: file, mtimeMs: stat.mtimeMs, size: stat.size, verdict: unknown ? 'unknown-model' : 'imported' });
  }
  return { events, verdicts, stats: { scanned, cacheSkipped }, skipped, errors };
}
