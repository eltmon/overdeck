/**
 * Session-format converter (P0, 2026-05-14).
 *
 * When a conversation's harness changes (Claude Code <-> Pi Agent), the two
 * runtimes store transcripts in incompatible JSONL formats and in different
 * locations:
 *
 *   - Claude Code: ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
 *   - Pi Agent:    ~/.overdeck/agents/<tmux-session>/sessions/<iso>_<id>.jsonl
 *
 * Historically the orchestrator would silently flip the harness and leave the
 * old transcript orphaned (the DB kept pointing at a session id with no file),
 * and the compaction path would even append Claude-format records into a Pi
 * JSONL. The chosen fix is to *convert* on an explicit harness change rather
 * than guard against it or build a multi-format reader.
 *
 * The conversion is deliberately lossless-of-content but lossy-of-structure:
 * we extract a readable transcript from the source format and seed a fresh
 * session in the target format with that transcript carried in as a single
 * continuation/summary message — the same "faux compaction boundary" mechanism
 * Overdeck already uses for native compaction. Tool-call structure, thinking
 * blocks, and per-message token accounting do not round-trip; the conversation
 * *content* does. This keeps the converter robust as both harness formats
 * continue to evolve.
 */

export interface TranscriptTurn {
  role: string;
  text: string;
}

/** Pull plain text out of a Claude/Pi `message.content` (string or block array). */
function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (typeof b['text'] === 'string') parts.push(b['text'] as string);
    else if (typeof b['thinking'] === 'string') parts.push(`[thinking] ${b['thinking'] as string}`);
    else if ((b['type'] === 'tool_use' || b['type'] === 'toolCall') && typeof b['name'] === 'string') {
      parts.push(`[tool_use: ${b['name'] as string}]`);
    } else if (b['type'] === 'tool_result' || b['type'] === 'toolResult') {
      const inner = extractContentText(b['content']);
      if (inner) parts.push(`[tool_result] ${inner}`);
    }
  }
  return parts.join('\n').trim();
}

/** Read a Pi Agent JSONL transcript into ordered role/text turns. */
export function extractPiTranscript(raw: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry['type'] !== 'message') continue;
    const message = entry['message'];
    if (!message || typeof message !== 'object') continue;
    const m = message as Record<string, unknown>;
    const role = typeof m['role'] === 'string' ? (m['role'] as string) : 'assistant';
    const text = extractContentText(m['content']);
    if (text) turns.push({ role, text });
  }
  return turns;
}

/**
 * Read a Codex rollout JSONL transcript into ordered role/text turns.
 *
 * Rollout files use a different schema from --json stdout:
 *   - task_started: the initial task (user role)
 *   - agent_message: a model turn (assistant role)
 *   - token_count: metadata — skipped
 *
 * We extract task_started as the user prompt and agent_message events as
 * assistant turns to produce a readable transcript.
 */
export function extractCodexTranscript(raw: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = entry['type'];
    if (type === 'task_started') {
      const task = typeof entry['task'] === 'string' ? (entry['task'] as string) : '';
      if (task) turns.push({ role: 'user', text: task });
    } else if (type === 'agent_message') {
      const content = typeof entry['content'] === 'string'
        ? (entry['content'] as string)
        : extractContentText(entry['content']);
      if (content) turns.push({ role: 'assistant', text: content });
    }
  }
  return turns;
}
