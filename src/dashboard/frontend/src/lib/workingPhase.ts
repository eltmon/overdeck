/**
 * Working phase detection for conversation spinners.
 *
 * Converts tool names and message state into a named "phase" that the UI
 * uses to pick an appropriate icon and tooltip for the active spinner.
 */

import type { WorkLogEntry } from '../components/chat/chat-types';

// ─── Phase types ─────────────────────────────────────────────────────────────

export type WorkingPhase =
  | 'init'        // session alive but no messages yet
  | 'thinking'    // assistant is streaming text output
  | 'bash'        // running a Bash / shell command
  | 'file'        // reading, writing, or editing files
  | 'search'      // Glob / Grep / directory listing
  | 'web'         // WebFetch / WebSearch
  | 'agent'       // spawning a sub-agent
  | 'tool'        // any other tool call
  | 'processing'; // last msg is user — waiting for next agent response

// ─── Tool name → phase ───────────────────────────────────────────────────────

const BASH_TOOLS = new Set([
  'Bash', 'bash', 'Execute', 'execute', 'execute_command', 'run_command',
  'computer', 'shell', 'RunCommand',
]);
const FILE_TOOLS = new Set([
  'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead',
  'CreateFile', 'DeleteFile', 'MoveFile', 'CopyFile', 'WriteFile', 'ReadFile',
  'EditFile',
]);
const SEARCH_TOOLS = new Set([
  'Glob', 'Grep', 'LS', 'ListFiles', 'ListDir', 'Find', 'Search',
  'SearchFiles', 'ReadDir', 'glob', 'grep', 'ls',
]);
const WEB_TOOLS = new Set([
  'WebFetch', 'WebSearch', 'web_search', 'brave_search', 'fetch',
  'web_fetch', 'BraveSearch',
]);
const AGENT_TOOLS = new Set([
  'Agent', 'Task', 'Dispatch', 'SubAgent', 'agent', 'task',
]);

export function toolNameToPhase(toolName: string): WorkingPhase {
  if (BASH_TOOLS.has(toolName)) return 'bash';
  if (FILE_TOOLS.has(toolName)) return 'file';
  if (SEARCH_TOOLS.has(toolName)) return 'search';
  if (WEB_TOOLS.has(toolName)) return 'web';
  if (AGENT_TOOLS.has(toolName)) return 'agent';
  return 'tool';
}

// ─── Phase detection ─────────────────────────────────────────────────────────

/**
 * Derives the current working phase from the message list and work log.
 * Call only when isWorking is already true.
 *
 * Priority:
 *  1. Pending tool entry (most specific — tells us exactly what's happening)
 *  2. Last message role (user = processing, assistant w/o completedAt = thinking)
 *  3. No messages yet = init
 */
export function getWorkingPhase(
  messages: Array<{ role: string; completedAt?: string }>,
  workLog: WorkLogEntry[],
): WorkingPhase {
  if (messages.length === 0) return 'init';

  // Find the most recent pending tool (tool sent but no result yet)
  for (let i = workLog.length - 1; i >= 0; i--) {
    const entry = workLog[i];
    if (entry.tone === 'tool' && !entry.result && entry.toolTitle) {
      return toolNameToPhase(entry.toolTitle);
    }
  }

  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role === 'user') return 'processing';
  return 'thinking';
}

// ─── Human-readable labels ───────────────────────────────────────────────────

/**
 * Returns a short label suitable for a tooltip on the working indicator.
 * `entry` is the pending workLog entry (if any) — used to extract specifics
 * like the bash command, file path, or search pattern.
 */
export function getPhaseLabel(phase: WorkingPhase, entry?: WorkLogEntry): string {
  if (entry?.detail) {
    try {
      const parsed = JSON.parse(entry.detail) as Record<string, unknown>;
      switch (phase) {
        case 'bash': {
          const cmd = typeof parsed['command'] === 'string' ? parsed['command'] : null;
          if (cmd) return `Running: ${cmd.length > 60 ? cmd.slice(0, 57) + '…' : cmd}`;
          break;
        }
        case 'file': {
          const path = (parsed['file_path'] ?? parsed['path'] ?? parsed['filename']) as string | undefined;
          if (typeof path === 'string') {
            const short = path.split('/').pop() ?? path;
            const verb = entry.toolTitle?.startsWith('Write') || entry.toolTitle?.startsWith('Edit')
              ? 'Writing'
              : 'Reading';
            return `${verb}: ${short}`;
          }
          break;
        }
        case 'search': {
          const pattern = (parsed['pattern'] ?? parsed['query'] ?? parsed['path']) as string | undefined;
          if (typeof pattern === 'string') {
            const short = pattern.length > 50 ? pattern.slice(0, 47) + '…' : pattern;
            return `Searching: ${short}`;
          }
          break;
        }
        case 'web': {
          const url = (parsed['url'] ?? parsed['query']) as string | undefined;
          if (typeof url === 'string') {
            const short = url.length > 50 ? url.slice(0, 47) + '…' : url;
            return `Fetching: ${short}`;
          }
          break;
        }
      }
    } catch {
      // ignore JSON parse errors
    }
  }

  switch (phase) {
    case 'init':       return 'Starting up';
    case 'thinking':   return 'Thinking';
    case 'bash':       return 'Running command';
    case 'file':       return 'Accessing files';
    case 'search':     return 'Searching';
    case 'web':        return 'Fetching web';
    case 'agent':      return 'Running agent';
    case 'tool':       return entry?.toolTitle ? `Using: ${entry.toolTitle}` : 'Using tool';
    case 'processing': return 'Processing';
  }
}

// ─── Pending entry helper ─────────────────────────────────────────────────────

/** Returns the most recent pending tool log entry (no result yet), if any. */
export function getPendingToolEntry(workLog: WorkLogEntry[]): WorkLogEntry | undefined {
  for (let i = workLog.length - 1; i >= 0; i--) {
    const entry = workLog[i];
    if (entry.tone === 'tool' && !entry.result) return entry;
  }
  return undefined;
}
