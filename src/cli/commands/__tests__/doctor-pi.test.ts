import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock child_process.execSync so `which pi` and `pi --version` are scripted per test.
// Pass through all other exports (execFile, spawn, etc.) so transitively imported
// modules like src/lib/tmux.ts continue to work.
const execSyncMock = vi.fn<(cmd: string, opts?: unknown) => string>()
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process')
  return {
    ...actual,
    execSync: (cmd: string, opts?: unknown) => execSyncMock(cmd, opts),
  }
})

// Mock fs.existsSync for the Pi extension dist file lookup. We must keep the rest
// of fs intact (other doctor checks may still call it transitively).
const existsSyncMock = vi.fn<(p: string) => boolean>()
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: (p: string) => existsSyncMock(p),
  }
})

import { checkPi, SUPPORTED_PI_VERSION_MIN } from '../doctor.js'

describe('doctor checkPi (PAN-636 — workspace-uem)', () => {
  beforeEach(() => {
    execSyncMock.mockReset()
    existsSyncMock.mockReset()
    existsSyncMock.mockReturnValue(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports OK with the resolved version when Pi is on PATH and >= min', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which pi')) return '/usr/local/bin/pi\n'
      if (cmd.startsWith('pi --version')) return `${SUPPORTED_PI_VERSION_MIN}\n`
      throw new Error(`unexpected command: ${cmd}`)
    })

    const results = checkPi(false)
    const pi = results.find((r) => r.name === 'Pi Coding Agent')!
    expect(pi.status).toBe('ok')
    expect(pi.message).toContain(SUPPORTED_PI_VERSION_MIN)
  })

  it('reports error when Pi is older than SUPPORTED_PI_VERSION_MIN', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which pi')) return '/usr/local/bin/pi\n'
      if (cmd.startsWith('pi --version')) return '0.50.0\n'
      throw new Error(`unexpected command: ${cmd}`)
    })

    const results = checkPi(false)
    const pi = results.find((r) => r.name === 'Pi Coding Agent')!
    expect(pi.status).toBe('error')
    expect(pi.message).toMatch(/too old/)
    expect(pi.message).toContain(SUPPORTED_PI_VERSION_MIN)
  })

  it('reports warn (not error) when Pi is missing in non-strict mode (AC: existing Claude Code workflows not blocked)', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which pi')) throw new Error('not found')
      throw new Error(`unexpected command: ${cmd}`)
    })

    const results = checkPi(false)
    const pi = results.find((r) => r.name === 'Pi Coding Agent')!
    expect(pi.status).toBe('warn')
    expect(pi.fix).toMatch(/npm install/)
  })

  it('escalates to error when Pi is missing AND --strict is set', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which pi')) throw new Error('not found')
      throw new Error(`unexpected command: ${cmd}`)
    })

    const results = checkPi(true)
    const pi = results.find((r) => r.name === 'Pi Coding Agent')!
    expect(pi.status).toBe('error')
  })

  it('warns and includes the build command when packages/pi-extension/dist/index.js is missing', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which pi')) return '/usr/local/bin/pi\n'
      if (cmd.startsWith('pi --version')) return '0.73.0\n'
      throw new Error(`unexpected command: ${cmd}`)
    })
    existsSyncMock.mockImplementation((p: string) => !p.endsWith('packages/pi-extension/dist/index.js'))

    const results = checkPi(false)
    const ext = results.find((r) => r.name === 'Pi Extension Bundle')!
    expect(ext.status).toBe('warn')
    expect(ext.fix).toMatch(/npm run build/)
  })

  it('parses version from stderr-style output (Pi prints version to stderr)', () => {
    // The implementation merges stderr via "2>&1"; the wrapper just returns trimmed output.
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which pi')) return '/usr/local/bin/pi\n'
      if (cmd.includes('pi --version')) return 'pi 0.99.1\nsome trailing noise\n'
      throw new Error(`unexpected command: ${cmd}`)
    })

    const results = checkPi(false)
    const pi = results.find((r) => r.name === 'Pi Coding Agent')!
    expect(pi.status).toBe('ok')
    expect(pi.message).toContain('0.99.1')
  })
})
