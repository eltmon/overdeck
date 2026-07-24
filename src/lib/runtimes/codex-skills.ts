import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Copy globally-synced Codex skills into an isolated managed CODEX_HOME.
 * Top-level destination-only skills are preserved so agent-specific additions
 * survive resume; source-owned skill directories are recursively refreshed.
 */
export function syncCodexSkillsIntoHome(sourceDir: string, destinationDir: string): void {
  if (!existsSync(sourceDir)) return
  mkdirSync(destinationDir, { recursive: true, mode: 0o700 })
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    cpSync(join(sourceDir, entry.name), join(destinationDir, entry.name), {
      recursive: true,
      force: true,
    })
  }
}
