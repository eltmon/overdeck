/**
 * PAN-3015: pull-based monitor transport for Claude Code sessions.
 *
 * A `pan monitor` process runs as a background task INSIDE the agent's Claude
 * Code session. Claude Code surfaces background-command stdout to the model at
 * the next turn boundary (and wakes an idle session), so a message printed by
 * the monitor reaches the model without any keystroke injection — no composer
 * paste, no echo confirmation, no Enter timing.
 *
 * This module holds the shared pieces: the presence protocol senders use to
 * decide the monitor tier is live, the mail-file format, and the drain logic.
 * The long-running loop lives in `src/cli/commands/monitor.ts`; the delivery
 * decision lives in `messageAgent` (src/lib/agents/messaging.ts) — mid-session
 * tells only, never kickoff/resume (no monitor exists before the first turn).
 * See docs/MONITOR-TRANSPORT.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { getAgentDir } from './agent-state.js';

/** Presence heartbeat cadence for a running monitor. */
export const MONITOR_HEARTBEAT_INTERVAL_MS = 15_000;
/** A heartbeat older than this (3 missed beats) means the monitor is gone. */
export const MONITOR_PRESENCE_FRESHNESS_MS = 45_000;
/** Monitor stdout blocks truncate here; `pan inbox` re-reads full bodies. */
export const MONITOR_BLOCK_MAX_BODY_CHARS = 4_000;

export interface MonitorPresence {
  pid: number;
  startedAt: string;
  heartbeatAt: string;
}

export interface ParsedMailMessage {
  source?: string;
  date?: string;
  body: string;
}

export function monitorPresencePath(agentId: string): string {
  return join(getAgentDir(agentId), 'monitor.json');
}

export function agentMailDir(agentId: string): string {
  return join(getAgentDir(agentId), 'mail');
}

export function agentMailReadDir(agentId: string): string {
  return join(agentMailDir(agentId), 'read');
}

export function writeMonitorPresence(agentId: string, pid: number, startedAt: Date, now: Date): void {
  const presence: MonitorPresence = {
    pid,
    startedAt: startedAt.toISOString(),
    heartbeatAt: now.toISOString(),
  };
  mkdirSync(getAgentDir(agentId), { recursive: true });
  writeFileSync(monitorPresencePath(agentId), JSON.stringify(presence, null, 2));
}

export function clearMonitorPresence(agentId: string): void {
  try {
    rmSync(monitorPresencePath(agentId), { force: true });
  } catch {
    // Best-effort; a stale file is caught by the freshness/pid checks.
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * A monitor counts as live only with BOTH a fresh heartbeat and a live pid —
 * a dead monitor must fall through to keystroke transports, not strand the
 * message unread (it stays durable in mail/ either way).
 */
export function isMonitorLive(agentId: string, nowMs: number = Date.now()): boolean {
  try {
    const raw = readFileSync(monitorPresencePath(agentId), 'utf-8');
    const presence = JSON.parse(raw) as Partial<MonitorPresence>;
    if (typeof presence.pid !== 'number' || typeof presence.heartbeatAt !== 'string') return false;
    const beatMs = Date.parse(presence.heartbeatAt);
    if (!Number.isFinite(beatMs) || nowMs - beatMs > MONITOR_PRESENCE_FRESHNESS_MS) return false;
    return isPidAlive(presence.pid);
  } catch {
    return false;
  }
}

/**
 * Mail-file format (PAN-3015 adds the provenance header; the legacy format is
 * `# Message\n\n<body>` and must keep parsing):
 *
 *   # Message
 *
 *   source: pan-tell
 *   date: 2026-07-24T00:00:00.000Z
 *
 *   <body>
 */
export function formatMailFileContent(body: string, source: string, date: Date): string {
  return `# Message\n\nsource: ${source}\ndate: ${date.toISOString()}\n\n${body}\n`;
}

export function parseMailFile(content: string): ParsedMailMessage {
  const withoutHeader = content.replace(/^# Message\n\n/, '');
  const sourceMatch = withoutHeader.match(/^source: (.+)\ndate: (.+)\n\n/);
  if (!sourceMatch) {
    return { body: withoutHeader.replace(/\n$/, '') };
  }
  return {
    source: sourceMatch[1],
    date: sourceMatch[2],
    body: withoutHeader.slice(sourceMatch[0].length).replace(/\n$/, ''),
  };
}

/**
 * Render one message as the stdout block the model sees. stdout carries these
 * blocks ONLY; monitor diagnostics go to stderr.
 */
export function formatAgentMessageBlock(
  agentId: string,
  message: ParsedMailMessage,
  maxBodyChars: number = MONITOR_BLOCK_MAX_BODY_CHARS,
): string {
  const meta = [
    message.source ? `source: ${message.source}` : null,
    message.date ? `at: ${message.date}` : null,
  ].filter(Boolean).join(' ');
  let body = message.body;
  if (body.length > maxBodyChars) {
    body = `${body.slice(0, maxBodyChars)}\n[overdeck:agent-message] truncated — run \`pan inbox ${agentId}\` to read the full body`;
  }
  return `[overdeck:agent-message]${meta ? ` ${meta}` : ''}\n${body}\n[overdeck:agent-message] end`;
}

/**
 * Monitor territory: every `.md` mail file except `.pending.md`, which belongs
 * to the codex notify hook. `.delivered.md` post-delivery backups (PAN-3738)
 * are deliberately included — they were plain `<ts>.md` files before the suffix
 * existed and the monitor drained them, so keeping them in preserves today's
 * behavior exactly. The suffix is for humans reading `mail/`, not a filter.
 */
function isPlainMailFile(name: string): boolean {
  return name.endsWith('.md') && !name.endsWith('.pending.md');
}

/**
 * Drain every unread plain mail file, oldest first. Each file is CLAIMED by
 * renaming it into mail/read/ before its block is emitted — a concurrent
 * drainer loses the rename and skips the file, so a message is never printed
 * twice (NFR-3). `.pending.md` (codex notify-hook territory) and `*.json`
 * (FPP mailbox) are never touched.
 *
 * Returns the number of messages emitted.
 */
export async function drainMailOnce(agentId: string, emit: (block: string) => void): Promise<number> {
  const mailDir = agentMailDir(agentId);
  const readDir = agentMailReadDir(agentId);
  let names: string[];
  try {
    names = (await readdir(mailDir)).filter(isPlainMailFile).sort();
  } catch {
    return 0;
  }
  if (names.length === 0) return 0;
  mkdirSync(readDir, { recursive: true });
  let emitted = 0;
  for (const name of names) {
    const claimed = join(readDir, name);
    try {
      renameSync(join(mailDir, name), claimed);
    } catch {
      continue; // Another drainer claimed it, or it vanished — never double-print.
    }
    const content = await readFile(claimed, 'utf-8');
    emit(formatAgentMessageBlock(agentId, parseMailFile(content)));
    emitted += 1;
  }
  return emitted;
}

export interface InboxMessage extends ParsedMailMessage {
  file: string;
  read: boolean;
}

/**
 * Full-body re-read for `pan inbox` — unread mail plus the read archive,
 * oldest first, most recent `limit` entries. Moves nothing, truncates nothing.
 */
export function listInboxMessagesSync(agentId: string, limit: number): InboxMessage[] {
  const collect = (dir: string, read: boolean): InboxMessage[] => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter(isPlainMailFile)
      .sort()
      .map((name) => ({
        ...parseMailFile(readFileSync(join(dir, name), 'utf-8')),
        file: name,
        read,
      }));
  };
  const all = [...collect(agentMailReadDir(agentId), true), ...collect(agentMailDir(agentId), false)]
    .sort((a, b) => a.file.localeCompare(b.file));
  return all.slice(-limit);
}
