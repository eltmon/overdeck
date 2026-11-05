/**
 * Fork adoption for human Claude conversations (PAN-2652).
 *
 * Claude Code can continue a running process in a new session file (backgrounding
 * a turn copies the history into a new session id). The launcher pin and the
 * process cmdline keep the old id, so nothing else notices. The 10-second
 * lifecycle poll calls adoptForkedClaudeSessions immediately before the /clear
 * orphan scan, and it re-points the conversation's current locator through the
 * one write door (setConversationClaudeSessionId), which an open Conversation
 * tab follows.
 *
 * A candidate is adopted only when it shares at least one copied entry uuid with
 * the current file (lineage), lives directly in the conversation's Claude project
 * dir, does not start with the /clear sentinel, and is not already a locator of
 * any conversation. Lineage is what keeps a post-/clear session and nested
 * `claude` runs in the same terminal session from being adopted. Copied entries
 * predate the fork, so a lineage verdict for a (current, candidate) pair never
 * changes and is cached for the life of the process.
 */
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { getOverdeckHome } from '../paths.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { claudeProjectDir } from '../runtimes/storage/claude-code.js';
import type { HarnessName } from '../runtimes/types.js';
import { parseSessionIndex } from '../session-history.js';
import { isSupersededConversation } from './conversation-clear-chain.js';
import {
  getConversationByClaudeSessionId,
  isAgentConversationName,
  setConversationClaudeSessionId,
  type LegacyConversation,
} from './conversations.js';

export interface ForkAdoptionDeps {
  overdeckHome: () => string;
  claudeProjectDir: (cwd: string) => string;
  /** True when any conversation already records this session id as a locator. */
  isLocatorOwned: (sessionId: string) => boolean;
  adopt: (conversationName: string, sessionId: string) => void;
  log: (message: string) => void;
  /** Lines of a file, streamed; breaking out of the loop closes the file. */
  openLines: (path: string) => AsyncIterable<string>;
}

async function* streamLines(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) yield line;
  } finally {
    rl.close();
    stream.destroy();
  }
}

export const defaultForkAdoptionDeps: ForkAdoptionDeps = {
  overdeckHome: getOverdeckHome,
  claudeProjectDir: (cwd) => claudeProjectDir(cwd),
  isLocatorOwned: (sessionId) => getConversationByClaudeSessionId(sessionId) !== null,
  adopt: (conversationName, sessionId) => setConversationClaudeSessionId(conversationName, sessionId),
  log: (message) => console.log(message),
  openLines: streamLines,
};

const HEAD_UUID_LIMIT = 20;
const HEAD_LINE_LIMIT = 400;
const LINEAGE_CACHE_LIMIT = 2_000;
const lineageCache = new Map<string, boolean>();

function cacheLineage(key: string, verdict: boolean): void {
  if (lineageCache.size >= LINEAGE_CACHE_LIMIT) {
    const oldest = lineageCache.keys().next().value;
    if (oldest !== undefined) lineageCache.delete(oldest);
  }
  lineageCache.set(key, verdict);
}

async function fileExists(path: string): Promise<boolean> {
  return stat(path).then((s) => s.isFile(), () => false);
}

function entryUuid(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const uuid = (JSON.parse(trimmed) as { uuid?: unknown }).uuid;
    return typeof uuid === 'string' && uuid ? uuid : null;
  } catch {
    return null;
  }
}

async function headUuids(path: string, deps: ForkAdoptionDeps): Promise<string[]> {
  const uuids: string[] = [];
  let lines = 0;
  for await (const line of deps.openLines(path)) {
    if (++lines > HEAD_LINE_LIMIT || uuids.length >= HEAD_UUID_LIMIT) break;
    const uuid = entryUuid(line);
    if (uuid) uuids.push(uuid);
  }
  return uuids;
}

async function fileContainsAnyUuid(path: string, uuids: readonly string[], deps: ForkAdoptionDeps): Promise<boolean> {
  const needles = uuids.map((uuid) => `"uuid":"${uuid}"`);
  for await (const line of deps.openLines(path)) {
    if (needles.some((needle) => line.includes(needle))) return true;
  }
  return false;
}

/**
 * Lineage verdict for (current file, candidate file): true when one of the first
 * 20 entry uuids of the candidate also appears in the current file. Null (not
 * cached) when the candidate has no uuid-bearing entry yet; it is retried next tick.
 */
async function sharesLineage(
  currentSessionId: string,
  currentPath: string,
  candidatePath: string,
  deps: ForkAdoptionDeps,
): Promise<boolean | null> {
  const key = `${currentSessionId}\u0000${candidatePath}`;
  const cached = lineageCache.get(key);
  if (cached !== undefined) return cached;
  const uuids = await headUuids(candidatePath, deps);
  if (uuids.length === 0) return null;
  const verdict = await fileContainsAnyUuid(currentPath, uuids, deps);
  cacheLineage(key, verdict);
  return verdict;
}

/**
 * Read the first ~5 lines of a JSONL and return the timestamp (ms since epoch) of
 * the first user-message whose content contains the literal `/clear` command
 * sentinel that Claude Code writes when the user clears the session. Returns
 * `null` if no such message is found in the early lines — i.e., this is not a
 * post-`/clear` orphan.
 *
 * Uses a streaming line reader bounded at 5 lines so a multi-megabyte snapshot
 * line at the head of the file doesn't load the whole transcript into memory.
 *
 * `definitive` is true when a null verdict can never change: the full 5-line
 * window was scanned (proven by seeing a 6th line). A shorter file may still
 * be growing, so its null verdict is provisional and must not be cached.
 */
export async function readFirstClearTimestamp(
  jsonlPath: string,
): Promise<{ clearTs: number | null; definitive: boolean }> {
  const stream = createReadStream(jsonlPath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineCount = 0;
  try {
    for await (const line of rl) {
      lineCount++;
      if (lineCount > 5) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: { type?: unknown; message?: { content?: unknown }; timestamp?: unknown } | null;
      try {
        obj = JSON.parse(trimmed) as typeof obj;
      } catch {
        continue;
      }
      if (obj?.type !== 'user') continue;
      const content = obj?.message?.content;
      if (typeof content !== 'string') continue;
      if (!content.includes('<command-name>/clear</command-name>')) continue;
      const ts = obj?.timestamp;
      if (typeof ts !== 'string') continue;
      const ms = new Date(ts).getTime();
      if (Number.isNaN(ms)) continue;
      return { clearTs: ms, definitive: true };
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return { clearTs: null, definitive: lineCount > 5 };
}

type EligibleConversation = LegacyConversation & { claudeSessionId: string; cwd: string; tmuxSession: string };

function isEligible(conv: LegacyConversation): conv is EligibleConversation {
  return conv.status === 'active'
    && !isAgentConversationName(conv.name)
    && !isSupersededConversation(conv)
    && getHarnessBehavior(conv.harness as HarnessName | null | undefined).transcriptKind === 'claude-jsonl'
    && !!conv.cwd
    && !!conv.claudeSessionId
    && !!conv.tmuxSession;
}

async function readIndexedSessionIds(conv: EligibleConversation, deps: ForkAdoptionDeps): Promise<string[]> {
  const indexPath = join(deps.overdeckHome(), 'agents', conv.tmuxSession, 'sessions.json');
  const text = await readFile(indexPath, 'utf8').catch(() => '');
  return parseSessionIndex(text).map((entry) => entry.sessionId);
}

/**
 * Source A: sessions the conversation's session index recorded after its current
 * session, newest first. The candidate file must sit directly in the
 * conversation's project dir, which also rejects sessions of processes in other
 * project dirs that the hooks attributed to the same terminal session.
 */
async function adoptFromSessionIndex(
  conv: EligibleConversation,
  currentPath: string,
  deps: ForkAdoptionDeps,
): Promise<string | null> {
  const ids = await readIndexedSessionIds(conv, deps);
  const after = ids.slice(ids.lastIndexOf(conv.claudeSessionId) + 1);
  const projectDir = deps.claudeProjectDir(conv.cwd);
  for (const candidateId of after.reverse()) {
    if (candidateId === conv.claudeSessionId || deps.isLocatorOwned(candidateId)) continue;
    const candidatePath = join(projectDir, `${candidateId}.jsonl`);
    if (!(await fileExists(candidatePath))) continue;
    if ((await readFirstClearTimestamp(candidatePath)).clearTs !== null) continue;
    if (await sharesLineage(conv.claudeSessionId, currentPath, candidatePath, deps)) return candidateId;
  }
  return null;
}

/** Adopt lineage-verified Claude Code forks as the current session of eligible conversations. */
export async function adoptForkedClaudeSessions(
  activeConvs: readonly LegacyConversation[],
  deps: ForkAdoptionDeps = defaultForkAdoptionDeps,
): Promise<void> {
  for (const conv of activeConvs) {
    if (!isEligible(conv)) continue;
    try {
      const currentPath = join(deps.claudeProjectDir(conv.cwd), `${conv.claudeSessionId}.jsonl`);
      if (!(await fileExists(currentPath))) continue;
      const adopted = await adoptFromSessionIndex(conv, currentPath, deps);
      if (!adopted) continue;
      deps.adopt(conv.name, adopted);
      deps.log(`[conversation-lifecycle] adopted forked Claude session ${adopted} for ${conv.name} (was ${conv.claudeSessionId})`);
    } catch (err: unknown) {
      console.warn(`[conversation-lifecycle] fork adoption failed for ${conv.name}: ${(err as Error).message}`);
    }
  }
}

/** Test hook: forget cached lineage verdicts. */
export function resetForkAdoptionCachesForTest(): void {
  lineageCache.clear();
}
