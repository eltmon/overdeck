import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execSyncMock = vi.fn<(cmd: string, opts?: unknown) => string | Buffer>()
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process')
  return {
    ...actual,
    execSync: (cmd: string, opts?: unknown) => execSyncMock(cmd, opts),
  }
})

import { syncPiSettingsSync } from '../sync.js'

const PI_SKILLS_TARGET = '/.claude/skills'

function withFakeHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'pan-pi-sync-'))
  const original = process.env['HOME']
  process.env['HOME'] = home
  return {
    home,
    cleanup: () => {
      if (original === undefined) delete process.env['HOME']
      else process.env['HOME'] = original
      rmSync(home, { recursive: true, force: true })
    },
  }
}

describe('syncPiSettings (PAN-636 — workspace-63b)', () => {
  let h: ReturnType<typeof withFakeHome>

  beforeEach(() => {
    h = withFakeHome()
    execSyncMock.mockReset()
  })

  afterEach(() => {
    h.cleanup()
    vi.restoreAllMocks()
  })

  it('AC1: creates ~/.pi/agent/settings.json with skills containing ~/.claude/skills when Pi is on PATH and the file is absent', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which pi')) return '/usr/local/bin/pi\n'
      throw new Error(`unexpected command: ${cmd}`)
    })

    const result = syncPiSettingsSync()

    expect(result.status).toBe('created')
    expect(result.path).toBe(join(h.home, '.pi', 'agent', 'settings.json'))

    const parsed = JSON.parse(readFileSync(result.path, 'utf-8'))
    expect(Array.isArray(parsed.skills)).toBe(true)
    expect(parsed.skills.some((s: string) => s.endsWith(PI_SKILLS_TARGET))).toBe(true)
  })

  it('AC2: preserves unrelated keys and only adds/updates the skills entry', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which pi')) return '/usr/local/bin/pi\n'
      throw new Error(`unexpected command: ${cmd}`)
    })

    const settingsPath = join(h.home, '.pi', 'agent', 'settings.json')
    mkdirSync(join(h.home, '.pi', 'agent'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify({
      apiKey: 'sk-secret',
      tokenLimit: 100000,
      // Existing skills entry that does NOT include the Claude path —
      // we expect the function to append, not replace.
      skills: ['/home/me/custom-skills'],
    }, null, 2))

    const result = syncPiSettingsSync()

    expect(result.status).toBe('updated')
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    expect(parsed.apiKey).toBe('sk-secret')
    expect(parsed.tokenLimit).toBe(100000)
    expect(parsed.skills).toContain('/home/me/custom-skills')
    expect(parsed.skills.some((s: string) => s.endsWith(PI_SKILLS_TARGET))).toBe(true)
  })

  it('AC3: does NOT touch ~/.pi/agent/settings.json when Pi is not on PATH', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which pi')) throw new Error('not found')
      throw new Error(`unexpected command: ${cmd}`)
    })

    const settingsPath = join(h.home, '.pi', 'agent', 'settings.json')
    const result = syncPiSettingsSync()

    expect(result.status).toBe('skipped')
    expect(result.reason).toMatch(/pi not on PATH/i)
    expect(existsSync(settingsPath)).toBe(false)
  })

  it('returns "unchanged" on a second sync when the skills entry is already present (idempotent)', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which pi')) return '/usr/local/bin/pi\n'
      throw new Error(`unexpected command: ${cmd}`)
    })

    const first = syncPiSettingsSync()
    expect(first.status).toBe('created')

    const second = syncPiSettingsSync()
    expect(second.status).toBe('unchanged')
  })

  it('leaves a malformed settings.json untouched and reports skipped (never clobbers user config)', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which pi')) return '/usr/local/bin/pi\n'
      throw new Error(`unexpected command: ${cmd}`)
    })

    const settingsPath = join(h.home, '.pi', 'agent', 'settings.json')
    mkdirSync(join(h.home, '.pi', 'agent'), { recursive: true })
    const malformed = '{ this is not valid json '
    writeFileSync(settingsPath, malformed)

    const result = syncPiSettingsSync()

    expect(result.status).toBe('skipped')
    expect(result.reason).toMatch(/not valid JSON/i)
    expect(readFileSync(settingsPath, 'utf-8')).toBe(malformed)
  })
})
