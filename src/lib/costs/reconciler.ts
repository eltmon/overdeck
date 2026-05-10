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
import { getDatabase } from '../database/index.js';
import { insertCostEvents } from '../database/cost-events-db.js';
import { calculateCost, getPricing, type AIProvider, type TokenUsage } from '../cost.js';

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

// ============== Path Helpers ==============

function getAgentsDir(): string {
  return join(process.env.HOME || homedir(), '.panopticon', 'agents');
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
    if (agentDir.startsWith('planning-')) {
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

function getSessionOffset(sessionId: string): number {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT byte_offset FROM processed_sessions WHERE session_id = ?'
  ).get(sessionId) as { byte_offset: number } | undefined;
  return row?.byte_offset || 0;
}

function saveSessionOffset(
  sessionId: string,
  byteOffset: number,
  newEvents: number,
  agentId: string,
  issueId: string,
  transcriptPath: string,
): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO processed_sessions (session_id, agent_id, issue_id, transcript_path, byte_offset, event_count, processed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      byte_offset = ?,
      event_count = processed_sessions.event_count + ?,
      processed_at = ?,
      agent_id = COALESCE(?, processed_sessions.agent_id),
      issue_id = COALESCE(?, processed_sessions.issue_id),
      transcript_path = COALESCE(?, processed_sessions.transcript_path)
  `).run(
    sessionId, agentId, issueId, transcriptPath, byteOffset, newEvents, new Date().toISOString(),
    byteOffset, newEvents, new Date().toISOString(),
    agentId, issueId, transcriptPath,
  );
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
): Array<import('../costs/events.js').CostEvent> {
  const events: Array<import('../costs/events.js').CostEvent> = [];
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
      const pricing = getPricing(provider, pricingModel);
      if (!pricing) continue;

      const tokenUsage: TokenUsage = { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cacheTTL: '5m' };
      const cost = calculateCost(tokenUsage, pricing);
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

// ============== Main Reconcile ==============

/**
 * Run a full reconciliation sweep.
 *
 * Scans ~/.claude/projects/ directly to find ALL transcript files,
 * then uses the session-to-agent index and path inference for attribution.
 */
export async function reconcile(): Promise<ReconcileResult> {
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

        // Batch insert — INSERT OR IGNORE handles dedup on request_id
        const { inserted, duplicates } = insertCostEvents(events, `reconciler:${transcriptPath}`);
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
            const { inserted, duplicates } = insertCostEvents(events, `reconciler:${transcriptPath}`);
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

  return result;
}
