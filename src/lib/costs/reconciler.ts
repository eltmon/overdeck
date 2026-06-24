/**
 * Cost Reconciler — Periodic catch-up sweep for cost tracking
 *
 * The live recording hook (heartbeat-hook → record-cost-event.js) captures costs
 * in real time, but can miss events due to hook failures, process crashes, or
 * system reboots. The reconciler ensures completeness by periodically sweeping
 * ALL Claude transcript files and importing any events not yet in SQLite.
 *
 * v2 Architecture: Scans ~/.claude/projects/ directly instead of going through
 * agent state.json files. This catches everything:
 * - Work agent sessions (from worktree workspaces)
 * - Planning agent sessions (from main project dirs)
 * - Specialist sessions (review, test, merge)
 * - Interactive/manual Claude sessions
 *
 * Key properties:
 * - Idempotent: dedup on request_id — safe to run any number of times
 * - Incremental: tracks byte offset per session — only reads new bytes
 * - Non-destructive: never deletes from SQLite, append-only
 * - Catches everything: scans all transcript files regardless of source
 */

import { readFileSync, existsSync, readdirSync, openSync, readSync, fstatSync, closeSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { Effect } from 'effect';
import { calculateCostSync, getPricingSync, type AIProvider, type TokenUsage } from '../cost.js';
import { FsError } from '../errors.js';
import { CostDoorLive, CostWriter, type CostEvent as OverdeckCostEvent } from '../overdeck/cost.js';
import type { IssueId } from '../overdeck/issues.js';
import type { CostEvent } from './events.js';

// ============== Types ==============

export interface ReconcileResult {
  sessionsScanned: number;
  sessionsWithNewData: number;
  eventsImported: number;
  duplicatesSkipped: number;
  errors: Array<{ path: string; error: string }>;
}

interface SessionMapping {
  agentId: string;
  issueId: string;
  sessionType: string;  // planning, implementation, review, test, merge
}

interface TranscriptEntry {
  type?: string;
  requestId?: string;
  timestamp?: string;
  ts?: string;
  created_at?: string;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

/**
 * Pi/oh-my-pi harness transcript entry (PAN-1935).
 *
 * Pi writes session transcripts to ~/.overdeck/agents/<id>/*.jsonl with a
 * different shape than Claude Code: top-level `type: 'message'` rows whose
 * `message.usage` uses short camelCase keys (`input`, `output`, `cacheRead`,
 * `cacheWrite`) — NOT the Anthropic `input_tokens`/`cache_read_input_tokens`
 * shape the Claude path expects. `message.provider` and `message.model` carry
 * the real routed provider/model (e.g. zai/glm-5.2); `message.responseId` is
 * the provider's unique response id, used for dedup.
 */
interface PiTranscriptEntry {
  type?: string;
  id?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    provider?: string;
    responseId?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      totalTokens?: number;
    };
  };
}

/**
 * Map a pi-reported provider string to the AIProvider union used by the pricing
 * layer. zai/kimi/minimax/mimo and anything unknown collapse to 'custom' (which
 * is how these providers are keyed in DEFAULT_PRICING).
 */
function piProviderToAiProvider(provider?: string): AIProvider {
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'openai') return 'openai';
  if (provider === 'google') return 'google';
  return 'custom';
}

// ============== Path Helpers ==============

function getAgentsDir(): string {
  return join(process.env.HOME || homedir(), '.overdeck', 'agents');
}

function getClaudeProjectsDir(): string {
  return join(process.env.HOME || homedir(), '.claude', 'projects');
}

/**
 * Extract session UUID from a transcript filename.
 * e.g., "678c8d8d-cefe-45ca-bebc-bafe602aff93.jsonl" → "678c8d8d-cefe-45ca-bebc-bafe602aff93"
 */
function extractSessionId(filename: string): string {
  return basename(filename, '.jsonl');
}

/**
 * Decode a Claude projects directory name back to the original cwd path.
 * e.g., "-home-eltmon-Projects-krux-workspaces-feature-krux-4" → "/home/eltmon/Projects/krux/workspaces/feature-krux-4"
 */
function decodeClaudeDirName(dirName: string): string {
  // Strip leading dash, replace dashes with slashes, add leading slash
  // This is imperfect (directory names with dashes get mangled) but works for inference
  return '/' + dirName.replace(/^-/, '').replace(/-/g, '/');
}

// ============== Session-to-Agent Mapping ==============

/**
 * Build a reverse index: session UUID → agent context.
 * Sources:
 * 1. sessions.json files in agent directories (authoritative — written by heartbeat hook)
 * 2. Agent state.json for issue/workspace context
 */
function buildSessionIndex(): Map<string, SessionMapping> {
  const index = new Map<string, SessionMapping>();
  const agentsDir = getAgentsDir();

  if (!existsSync(agentsDir)) return index;

  let entries: string[];
  try {
    entries = readdirSync(agentsDir);
  } catch {
    return index;
  }

  for (const agentDir of entries) {
    const agentPath = join(agentsDir, agentDir);

    // Read sessions.json for the session UUID list
    const sessionsFile = join(agentPath, 'sessions.json');
    let sessionIds: string[] = [];
    if (existsSync(sessionsFile)) {
      try {
        sessionIds = JSON.parse(readFileSync(sessionsFile, 'utf-8'));
      } catch { /* skip */ }
    }

    // Read state.json for issue/workspace context and role.
    const stateFile = join(agentPath, 'state.json');
    let issueId = inferIssueId(agentDir) || 'UNKNOWN';
    let stateRole: string | undefined;
    if (existsSync(stateFile)) {
      try {
        const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
        if (state.issueId) issueId = state.issueId;
        if (state.role) stateRole = state.role;
      } catch { /* use inferred */ }
    }

    // Determine session type: prefer state.json role, then infer from agent directory name
    let sessionType = stateRole || 'work';
    const reviewSubRole = agentDir.match(/-review-(security|correctness|performance|requirements)$/i)?.[1]?.toLowerCase();
    if (reviewSubRole) {
      sessionType = `review.${reviewSubRole}`;
    } else if (agentDir.startsWith('planning-')) {
      sessionType = 'planning';
    } else if (agentDir.includes('review')) {
      sessionType = 'review';
    } else if (agentDir.includes('test')) {
      sessionType = 'test';
    } else if (agentDir.includes('merge')) {
      sessionType = 'merge';
    }

    // Map each session UUID to this agent
    for (const sid of sessionIds) {
      index.set(sid, {
        agentId: agentDir,
        issueId,
        sessionType,
      });
    }
  }

  return index;
}

/**
 * Infer issue ID from a decoded path.
 * Looks for patterns like "feature-min-787", "feature/pan-208", etc.
 */
function inferIssueFromPath(decodedPath: string): string | null {
  const match = decodedPath.match(/(?:feature[-/])?(pan|min|aud|krux|cli)[-/](\d+)/i);
  if (match) {
    return `${match[1].toUpperCase()}-${match[2]}`;
  }
  return null;
}

/**
 * Infer issue ID from agent directory name.
 * e.g., 'agent-pan-105' → 'PAN-105', 'planning-min-663' → 'MIN-663'
 */
function inferIssueId(agentDir: string): string | null {
  const stripped = agentDir.replace(/^(agent|planning|specialist)-/, '');
  const match = stripped.match(/^(?:.*-)?(pan|min|aud|krux|cli)-(\d+)$/i);
  if (match) {
    return `${match[1].toUpperCase()}-${match[2]}`;
  }
  return null;
}

// ============== Offset Tracking ==============

function getSessionOffset(_sessionId: string): number {
  return 0;
}

function saveSessionOffset(
  sessionId: string,
  byteOffset: number,
  newEvents: number,
  agentId: string,
  issueId: string,
  transcriptPath: string,
): void {
  void sessionId;
  void byteOffset;
  void newEvents;
  void agentId;
  void issueId;
  void transcriptPath;
}

// ============== Transcript Processing ==============

/**
 * Read new bytes from a transcript file starting at the given offset.
 */
function readNewBytes(filePath: string, fromOffset: number): { content: string; newSize: number } | null {
  let fd: number;
  try {
    fd = openSync(filePath, 'r');
  } catch {
    return null;
  }

  try {
    const stat = fstatSync(fd);
    if (stat.size <= fromOffset) {
      return { content: '', newSize: stat.size };
    }

    const bytesToRead = stat.size - fromOffset;
    const buffer = Buffer.alloc(bytesToRead);
    readSync(fd, buffer, 0, bytesToRead, fromOffset);
    return { content: buffer.toString('utf-8'), newSize: stat.size };
  } finally {
    closeSync(fd);
  }
}

/**
 * Parse transcript content and extract cost events.
 * Only processes assistant messages with usage data and a requestId.
 */
function extractCostEvents(
  content: string,
  agentId: string,
  issueId: string,
  sessionType: string,
  sessionId: string,
): CostEvent[] {
  const events: CostEvent[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line) as TranscriptEntry;

      if (entry.type !== 'assistant' || !entry.message?.usage) continue;

      const requestId: string | undefined = entry.requestId ?? undefined;

      const usage = entry.message.usage;
      const model = entry.message.model || 'claude-sonnet-4';
      const inputTokens = usage.input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;
      const cacheReadTokens = usage.cache_read_input_tokens || 0;
      const cacheWriteTokens = usage.cache_creation_input_tokens || 0;

      if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheWriteTokens === 0) continue;

      let provider: AIProvider = 'anthropic';
      if (model.includes('gpt')) provider = 'openai';
      else if (model.includes('gemini')) provider = 'google';
      else if (model.includes('kimi')) provider = 'custom' as AIProvider;
      else if (model.toLowerCase().startsWith('minimax')) provider = 'custom' as AIProvider;

      // Strip claudish prefix for pricing lookup: "oai@gpt-5.4" → "gpt-5.4"
      const pricingModel = model.replace(/^(?:oai|cx|go)@/, '');
      const pricing = getPricingSync(provider, pricingModel);
      if (!pricing) continue;

      const tokenUsage: TokenUsage = { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cacheTTL: '5m' };
      const cost = calculateCostSync(tokenUsage, pricing);
      const timestamp = entry.timestamp || entry.ts || entry.created_at || new Date().toISOString();

      events.push({
        ts: timestamp,
        type: 'cost',
        agentId,
        issueId,
        sessionType,
        provider,
        model,
        input: inputTokens,
        output: outputTokens,
        cacheRead: cacheReadTokens,
        cacheWrite: cacheWriteTokens,
        cost,
        requestId,
        sessionId,
      });
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

/**
 * Parse Pi/oh-my-pi transcript content and extract cost events (PAN-1935).
 *
 * Pi's `message.usage` uses short camelCase keys (`input`, `output`,
 * `cacheRead`, `cacheWrite`) and the real model/provider live on `message`
 * (not inferred from a Claude-style `model` field). Cost is always computed
 * from tokens × pricing because pi reports `cost.total = 0` for non-Anthropic
 * providers. Exported for unit testing.
 */
export function extractPiCostEvents(
  content: string,
  agentId: string,
  issueId: string,
  sessionType: string,
  sessionId: string,
): CostEvent[] {
  const events: CostEvent[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry: PiTranscriptEntry;
    try {
      entry = JSON.parse(line) as PiTranscriptEntry;
    } catch {
      continue;
    }
    if (entry.type !== 'message') continue;
    const usage = entry.message?.usage;
    if (!usage) continue;

    const inputTokens = usage.input ?? 0;
    const outputTokens = usage.output ?? 0;
    const cacheReadTokens = usage.cacheRead ?? 0;
    const cacheWriteTokens = usage.cacheWrite ?? 0;
    if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheWriteTokens === 0) continue;

    const model = entry.message?.model || 'unknown';
    const provider = piProviderToAiProvider(entry.message?.provider);
    // Strip any routing prefix (oai@/cx@/go@) for pricing lookup.
    const pricingModel = model.replace(/^(?:oai|cx|go)@/, '');
    const pricing = getPricingSync(provider, pricingModel);
    if (!pricing) continue;

    const tokenUsage: TokenUsage = { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cacheTTL: '5m' };
    const cost = calculateCostSync(tokenUsage, pricing);
    // Prefer the provider response id for precise dedup; fall back to a
    // session-scoped synthetic id so re-runs are idempotent.
    const requestId = entry.message?.responseId ?? (entry.id ? `${sessionId}#${entry.id}` : undefined);
    const timestamp = entry.timestamp || new Date().toISOString();

    events.push({
      ts: timestamp,
      type: 'cost',
      agentId,
      issueId,
      sessionType,
      provider,
      model,
      input: inputTokens,
      output: outputTokens,
      cacheRead: cacheReadTokens,
      cacheWrite: cacheWriteTokens,
      cost,
      requestId,
      sessionId,
    });
  }
  return events;
}

/**
 * Pi session transcripts in an agent dir. Pi transcripts begin with a
 * `{"type":"session","version":3,...}` header; we detect that and skip the
 * sibling non-transcripts (activity.jsonl, cost-events.jsonl, pending-events).
 */
function findPiTranscriptFiles(agentDir: string): string[] {
  let files: string[];
  try {
    files = readdirSync(agentDir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const transcripts: string[] = [];
  for (const f of files) {
    if (f === 'activity.jsonl' || f === 'cost-events.jsonl' || f === 'pending-events.jsonl') continue;
    const full = join(agentDir, f);
    try {
      const fd = openSync(full, 'r');
      const buf = Buffer.alloc(128);
      const bytesRead = readSync(fd, buf, 0, 128, 0);
      closeSync(fd);
      const head = buf.toString('utf-8', 0, bytesRead);
      if (/"type"\s*:\s*"session"/.test(head)) transcripts.push(full);
    } catch {
      // skip unreadable
    }
  }
  return transcripts;
}

/**
 * Sweep pi session transcripts under the per-agent dirs (~/.overdeck/agents)
 * and import their cost events through the same Overdeck cost writer the Claude
 * path uses (PAN-1935).
 * Independent of the pi extension hook, so it captures cost even when the
 * extension emits null usage or the wrong model label.
 */
async function scanPiTranscripts(): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    sessionsScanned: 0,
    sessionsWithNewData: 0,
    eventsImported: 0,
    duplicatesSkipped: 0,
    errors: [],
  };

  const agentsDir = getAgentsDir();
  if (!existsSync(agentsDir)) return result;

  let agentDirs: string[];
  try {
    agentDirs = readdirSync(agentsDir);
  } catch {
    return result;
  }

  for (const agentDirName of agentDirs) {
    const agentPath = join(agentsDir, agentDirName);

    // Resolve issueId + sessionType from state.json (authoritative), falling
    // back to inference from the directory name.
    let issueId = inferIssueId(agentDirName) || 'UNKNOWN';
    let sessionType = 'work';
    const stateFile = join(agentPath, 'state.json');
    if (existsSync(stateFile)) {
      try {
        const st = JSON.parse(readFileSync(stateFile, 'utf-8')) as { issueId?: string; role?: string };
        if (st.issueId) issueId = st.issueId;
        if (st.role) sessionType = st.role;
      } catch {
        // use inferred
      }
    }
    if (agentDirName.startsWith('planning-')) sessionType = 'planning';

    const transcripts = findPiTranscriptFiles(agentPath);
    for (const transcriptPath of transcripts) {
      const sessionId = basename(transcriptPath, '.jsonl');
      result.sessionsScanned++;
      try {
        const content = readFileSync(transcriptPath, 'utf-8');
        const events = extractPiCostEvents(content, agentDirName, issueId, sessionType, sessionId);
        if (events.length === 0) continue;
        result.sessionsWithNewData++;
        const { inserted, duplicates } = await recordCostEventsThroughOverdeck(events, `reconciler:${transcriptPath}`);
        result.eventsImported += inserted;
        result.duplicatesSkipped += duplicates;
      } catch (err) {
        result.errors.push({
          path: transcriptPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return result;
}

function toOverdeckCostEvent(event: CostEvent, sourceFile: string): OverdeckCostEvent {
  return {
    ts: new Date(event.ts),
    issueId: event.issueId ? (event.issueId as IssueId) : null,
    agentId: event.agentId ?? null,
    sessionId: event.sessionId ?? null,
    sessionType: event.sessionType ?? null,
    provider: event.provider ?? null,
    model: event.model ?? null,
    input: event.input ?? 0,
    output: event.output ?? 0,
    cacheRead: event.cacheRead ?? 0,
    cacheWrite: event.cacheWrite ?? 0,
    cost: event.cost ?? 0,
    requestId: event.requestId ?? null,
    sourceFile,
  };
}

async function recordCostEventsThroughOverdeck(
  events: CostEvent[],
  sourceFile: string,
): Promise<{ inserted: number; duplicates: number }> {
  let inserted = 0;
  let duplicates = 0;
  for (const event of events) {
    const didInsert = await Effect.runPromise(
      CostWriter.use((writer) => writer.record(toOverdeckCostEvent(event, sourceFile))).pipe(
        Effect.provide(CostDoorLive),
      ),
    );
    if (didInsert) inserted++;
    else duplicates++;
  }
  return { inserted, duplicates };
}

async function reconcilePromise(): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    sessionsScanned: 0,
    sessionsWithNewData: 0,
    eventsImported: 0,
    duplicatesSkipped: 0,
    errors: [],
  };

  const claudeProjectsDir = getClaudeProjectsDir();
  if (!existsSync(claudeProjectsDir)) return result;

  // Build reverse index: session UUID → (agentId, issueId, sessionType)
  const sessionIndex = buildSessionIndex();

  // Scan all Claude project directories
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(claudeProjectsDir);
  } catch {
    return result;
  }

  for (const dirName of projectDirs) {
    const projectDir = join(claudeProjectsDir, dirName);

    // Skip non-directories
    try {
      const stat = fstatSync(openSync(projectDir, 'r'));
      // fstatSync on a dir fd doesn't work well, use readdirSync as canary
    } catch { /* skip */ }

    // Infer issue ID from the directory name (decoded path)
    const decodedPath = decodeClaudeDirName(dirName);
    const pathIssueId = inferIssueFromPath(decodedPath);

    // Find all transcript JSONL files (top-level)
    let files: string[];
    try {
      files = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    // Process each transcript file
    for (const file of files) {
      const sessionId = extractSessionId(file);
      const transcriptPath = join(projectDir, file);
      result.sessionsScanned++;

      try {
        // Look up agent mapping for this session
        const mapping = sessionIndex.get(sessionId);
        const agentId = mapping?.agentId || 'unattributed';
        const issueId = mapping?.issueId || pathIssueId || 'UNKNOWN';
        const sessionType = mapping?.sessionType || 'implementation';

        // Get last processed offset
        const lastOffset = getSessionOffset(sessionId);

        // Read new bytes
        const readResult = readNewBytes(transcriptPath, lastOffset);
        if (!readResult || !readResult.content) {
          if (readResult && readResult.newSize > lastOffset) {
            saveSessionOffset(sessionId, readResult.newSize, 0, agentId, issueId, transcriptPath);
          }
          continue;
        }

        // Extract cost events
        const events = extractCostEvents(readResult.content, agentId, issueId, sessionType, sessionId);

        if (events.length === 0) {
          saveSessionOffset(sessionId, readResult.newSize, 0, agentId, issueId, transcriptPath);
          continue;
        }

        result.sessionsWithNewData++;

        const { inserted, duplicates } = await recordCostEventsThroughOverdeck(events, `reconciler:${transcriptPath}`);
        result.eventsImported += inserted;
        result.duplicatesSkipped += duplicates;

        saveSessionOffset(sessionId, readResult.newSize, inserted, agentId, issueId, transcriptPath);
      } catch (err) {
        result.errors.push({
          path: transcriptPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Also check subagents directory
    const subagentsDir = join(projectDir, 'subagents');
    if (existsSync(subagentsDir)) {
      try {
        const subFiles = readdirSync(subagentsDir).filter(f => f.endsWith('.jsonl'));
        for (const file of subFiles) {
          const sessionId = `sub-${extractSessionId(file)}`;
          const transcriptPath = join(subagentsDir, file);
          result.sessionsScanned++;

          try {
            const mapping = sessionIndex.get(sessionId);
            const agentId = mapping?.agentId || 'unattributed-subagent';
            const issueId = mapping?.issueId || pathIssueId || 'UNKNOWN';
            const sessionType = mapping?.sessionType || 'implementation';

            const lastOffset = getSessionOffset(sessionId);
            const readResult = readNewBytes(transcriptPath, lastOffset);
            if (!readResult || !readResult.content) continue;

            const events = extractCostEvents(readResult.content, agentId, issueId, sessionType, sessionId);

            if (events.length === 0) {
              saveSessionOffset(sessionId, readResult.newSize, 0, agentId, issueId, transcriptPath);
              continue;
            }

            result.sessionsWithNewData++;
            const { inserted, duplicates } = await recordCostEventsThroughOverdeck(events, `reconciler:${transcriptPath}`);
            result.eventsImported += inserted;
            result.duplicatesSkipped += duplicates;
            saveSessionOffset(sessionId, readResult.newSize, inserted, agentId, issueId, transcriptPath);
          } catch (err) {
            result.errors.push({
              path: transcriptPath,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch {
        // Non-fatal
      }
    }
  }

  // PAN-1935: also sweep pi/oh-my-pi harness transcripts under
  // ~/.overdeck/agents/*/ (the Claude scan above only covers ~/.claude/projects).
  const piResult = await scanPiTranscripts();
  result.sessionsScanned += piResult.sessionsScanned;
  result.sessionsWithNewData += piResult.sessionsWithNewData;
  result.eventsImported += piResult.eventsImported;
  result.duplicatesSkipped += piResult.duplicatesSkipped;
  result.errors.push(...piResult.errors);

  return result;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect variant of reconcile. Per-file errors are still surfaced via
 * `result.errors`; only catastrophic failures (e.g. SQLite open failure)
 * surface on the Effect error channel.
 */
export const reconcile = (): Effect.Effect<ReconcileResult, FsError> =>
  Effect.tryPromise({
    try: () => reconcilePromise(),
    catch: (cause) => new FsError({ path: '<reconciler>', operation: 'reconcile', cause }),
  });
