import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Source-level regression guard for the harness badge wired by PAN-636 workspace-dbf.
// A full mount of IssueAgentCard pulls in DialogProvider + react-query + Zustand and is
// out of scope for this AC — we only need to ensure the badge keeps using getHarness().

const SRC = readFileSync(
  resolve(import.meta.dirname, '..', 'IssueAgentCard.tsx'),
  'utf-8',
)

describe('IssueAgentCard harness badge (PAN-636 workspace-dbf)', () => {
  it('AC: card renders a span tagged data-testid="agent-harness-badge" sourced from getHarness(agent)', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*getHarness[^}]*\}\s*from\s*['"]@panctl\/contracts['"]/)
    expect(SRC).toContain('data-testid="agent-harness-badge"')
    // The badge content must come from getHarness(agent), not a string literal or
    // the raw runtime/harness field — that would skip legacy normalization.
    expect(SRC).toMatch(/data-testid="agent-harness-badge"[\s\S]*?\{getHarness\(agent\)\}/)
  })

  it('badge styling differentiates pi from claude-code so a mixed-harness pipeline is readable at a glance', () => {
    // Pi gets a distinct background tint vs claude-code so the user can tell harnesses
    // apart on a single board (decision tracked in continue.json D3).
    expect(SRC).toMatch(/getHarness\(agent\)\s*===\s*['"]pi['"]/)
  })
})
