/**
 * Pi transcript storage (PAN-3958 CH-7, D11): the only place that knows where a
 * Pi agent's transcripts live — `<agentDir>/sessions/**.jsonl`, plus per-run
 * JSONL in the agent-dir root — and where the user's own Pi keeps them
 * (`~/.pi/agent/sessions`). (Oh My Pi shares this layout today; its own module
 * is out of scope, #4003.)
 *
 * Leaf module: imports only `node:*`, so any layer can import it without
 * creating a cycle. `npm run lint:harness-storage` keeps these paths from being
 * rebuilt anywhere else.
 */
import { readdir as readdirAsync, stat as statAsync } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The user's own Pi agent directory, `~/.pi/agent` (Pi runs outside Overdeck). */
export function piUserAgentDir(): string {
  return join(homedir(), '.pi', 'agent')
}

/** A Pi agent's session directory: `<agentDir>/sessions`. */
export function piSessionsRoot(agentDir: string): string {
  return join(agentDir, 'sessions')
}

const NON_TRANSCRIPT_JSONL = new Set([
  'acp-session.jsonl',
  'cost-events.jsonl',
  'activity.jsonl',
  'pending-events.jsonl',
])

/** Resolve a Pi/oh-my-pi transcript from the runtime-owned session layout. */
export async function findPiTranscriptPath(
  agentDir: string,
  sessionId?: string,
): Promise<string | null> {
  const files: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdirAsync(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path)
    }
  }
  await walk(piSessionsRoot(agentDir))
  const rootEntries = await readdirAsync(agentDir, { withFileTypes: true }).catch(() => [])
  for (const entry of rootEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile() && entry.name.endsWith('.jsonl') && !NON_TRANSCRIPT_JSONL.has(entry.name)) {
      files.push(join(agentDir, entry.name))
    }
  }
  if (sessionId) {
    return files.find((path) => path.endsWith(`_${sessionId}.jsonl`) || path.endsWith(`/${sessionId}.jsonl`)) ?? null
  }
  const withMtime = await Promise.all(files.map(async path => ({
    path,
    mtime: await statAsync(path).then(info => info.mtimeMs, () => -1),
  })))
  return withMtime.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path))[0]?.path ?? null
}
