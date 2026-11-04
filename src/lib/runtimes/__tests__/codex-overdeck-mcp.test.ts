import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { initCodexHome } from '../codex.js'

function withFakeCodexHome(): { codexHome: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'pan-codex-mcp-approval-'))
  const codexHome = join(base, '.codex')
  mkdirSync(codexHome, { recursive: true })
  const originalCodexHome = process.env['CODEX_HOME']
  const originalHome = process.env['HOME']
  process.env['CODEX_HOME'] = codexHome
  process.env['HOME'] = base
  return {
    codexHome,
    cleanup: () => {
      if (originalCodexHome === undefined) {
        delete process.env['CODEX_HOME']
      } else {
        process.env['CODEX_HOME'] = originalCodexHome
      }
      if (originalHome === undefined) {
        delete process.env['HOME']
      } else {
        process.env['HOME'] = originalHome
      }
      rmSync(base, { recursive: true, force: true })
    },
  }
}

describe('initCodexHome — [mcp_servers.overdeck] default_tools_approval_mode (PAN-4933)', () => {
  let ctx: ReturnType<typeof withFakeCodexHome>
  beforeEach(() => { ctx = withFakeCodexHome() })
  afterEach(() => ctx.cleanup())

  it('writes default_tools_approval_mode after the env table for a valid mode', () => {
    const codexDir = join(ctx.codexHome, 'agent-approval-valid')
    initCodexHome(codexDir, {
      effort: 'high',
      mcpServers: {
        overdeck: {
          type: 'stdio',
          command: 'overdeck',
          args: ['mcp', 'serve'],
          env: { ODK_TOKEN: 'secret' },
          defaultToolsApprovalMode: 'approve',
        },
      },
    })

    const config = readFileSync(join(codexDir, 'config.toml'), 'utf8')
    expect(config).toContain('[mcp_servers.overdeck]')
    const envLineIndex = config.indexOf('env = { "ODK_TOKEN" = "secret" }')
    expect(envLineIndex).toBeGreaterThan(-1)
    const afterEnv = config.slice(envLineIndex)
    expect(afterEnv.split('\n')[1]).toBe('default_tools_approval_mode = "approve"')
    expect(config).not.toContain('odk_')
  })

  it('omits default_tools_approval_mode and warns once for an invalid mode', () => {
    const codexDir = join(ctx.codexHome, 'agent-approval-invalid')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    initCodexHome(codexDir, {
      effort: 'high',
      mcpServers: {
        overdeck: {
          type: 'stdio',
          command: 'overdeck',
          args: ['mcp', 'serve'],
          defaultToolsApprovalMode: 'bogus' as never,
        },
      },
    })

    const config = readFileSync(join(codexDir, 'config.toml'), 'utf8')
    expect(config).not.toContain('default_tools_approval_mode')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('overdeck')
    warn.mockRestore()
  })

  it('writes a server without defaultToolsApprovalMode exactly as before', () => {
    const codexDir = join(ctx.codexHome, 'agent-approval-absent')
    initCodexHome(codexDir, {
      effort: 'high',
      mcpServers: {
        playwright: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.0.78'] },
      },
    })

    const config = readFileSync(join(codexDir, 'config.toml'), 'utf8')
    expect(config).toContain('[mcp_servers.playwright]\ncommand = "npx"\nargs = ["-y", "@playwright/mcp@0.0.78"]')
    expect(config).not.toContain('default_tools_approval_mode')
  })
})
