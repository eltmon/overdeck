import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock child_process.execSync so `which omp` and `omp --version` are scripted per test.
const execSyncMock = vi.fn<(cmd: string, opts?: unknown) => string>()
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process')
  return {
    ...actual,
    execSync: (cmd: string, opts?: unknown) => execSyncMock(cmd, opts),
  }
})

// Mock fs.existsSync for the ohmypi extension dist file lookup.
const existsSyncMock = vi.fn<(p: string) => boolean>()
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: (p: string) => existsSyncMock(p),
  }
})

// Mock ohmypi-codex-auth so readOhmypiCodexCredential is controllable.
const readOhmypiCodexCredentialMock = vi.fn<() => null>()
vi.mock('../../../lib/ohmypi-codex-auth.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/ohmypi-codex-auth.js')>('../../../lib/ohmypi-codex-auth.js')
  return {
    ...actual,
    readOhmypiCodexCredential: () => readOhmypiCodexCredentialMock(),
  }
})

import { checkOhmypi, SUPPORTED_OMP_VERSION_MIN } from '../doctor.js'

describe('doctor checkOhmypi (PAN-1989)', () => {
  beforeEach(() => {
    execSyncMock.mockReset()
    existsSyncMock.mockReset()
    readOhmypiCodexCredentialMock.mockReset()
    // By default, the extension bundle exists and no codex credential is present.
    existsSyncMock.mockReturnValue(true)
    readOhmypiCodexCredentialMock.mockReturnValue(null)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('AC: reports OK with the resolved version when omp is on PATH and >= min', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which omp')) return '/usr/local/bin/omp\n'
      if (cmd.startsWith('omp --version')) return `omp/${SUPPORTED_OMP_VERSION_MIN}\n`
      throw new Error(`unexpected command: ${cmd}`)
    })

    const results = checkOhmypi(false)
    const omp = results.find((r) => r.name === 'oh-my-pi (omp)')!
    expect(omp.status).toBe('ok')
    expect(omp.message).toContain(SUPPORTED_OMP_VERSION_MIN)
  })

  it('AC: reports warn (or error in strict) when omp is older than SUPPORTED_OMP_VERSION_MIN', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which omp')) return '/usr/local/bin/omp\n'
      if (cmd.startsWith('omp --version')) return 'omp/0.1.0\n'
      throw new Error(`unexpected command: ${cmd}`)
    })

    const nonStrict = checkOhmypi(false)
    const strict = checkOhmypi(true)
    const nsOmp = nonStrict.find((r) => r.name === 'oh-my-pi (omp)')!
    const sOmp = strict.find((r) => r.name === 'oh-my-pi (omp)')!
    expect(nsOmp.status).toBe('warn')
    expect(sOmp.status).toBe('error')
    expect(nsOmp.message).toMatch(/too old/)
    expect(nsOmp.message).toContain(SUPPORTED_OMP_VERSION_MIN)
  })

  it('AC: reports warn (not error) when omp is absent in non-strict mode', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which omp')) throw new Error('not found')
      throw new Error(`unexpected command: ${cmd}`)
    })

    const results = checkOhmypi(false)
    const omp = results.find((r) => r.name === 'oh-my-pi (omp)')!
    expect(omp.status).toBe('warn')
    expect(omp.message).toMatch(/not installed/i)
    expect(omp.fix).toMatch(/npm install/)
    expect(omp.fix).toMatch(/@oh-my-pi\/pi-coding-agent/)
  })

  it('AC: escalates to error when omp is absent AND --strict is set', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which omp')) throw new Error('not found')
      throw new Error(`unexpected command: ${cmd}`)
    })

    const results = checkOhmypi(true)
    const omp = results.find((r) => r.name === 'oh-my-pi (omp)')!
    expect(omp.status).toBe('error')
  })

  it('AC: reports warn when the ohmypi extension bundle is missing', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which omp')) return '/usr/local/bin/omp\n'
      if (cmd.startsWith('omp --version')) return `omp/${SUPPORTED_OMP_VERSION_MIN}\n`
      throw new Error(`unexpected command: ${cmd}`)
    })
    // Both candidate locations must be absent for the bundle to count as missing
    // (shipped dist/extensions/ohmypi.js and the dev packages/ build).
    existsSyncMock.mockImplementation((p: string) =>
      !p.endsWith('dist/extensions/ohmypi.js') &&
      !p.endsWith('packages/ohmypi-extension/dist/index.js'),
    )

    const results = checkOhmypi(false)
    const ext = results.find((r) => r.name === 'ohmypi Extension Bundle')!
    expect(ext.status).toBe('warn')
    expect(ext.fix).toMatch(/npm run build/)
  })

  it('AC: shows ~/.omp codex auth status when a valid token exists', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which omp')) return '/usr/local/bin/omp\n'
      if (cmd.startsWith('omp --version')) return `omp/${SUPPORTED_OMP_VERSION_MIN}\n`
      throw new Error(`unexpected command: ${cmd}`)
    })
    readOhmypiCodexCredentialMock.mockReturnValue({
      access: 'tok-abc',
      refresh: 'ref-xyz',
      expires: Date.now() + 3_600_000,
      accountId: 'acct-1',
    } as any)

    const results = checkOhmypi(false)
    const auth = results.find((r) => r.name === 'ohmypi ChatGPT/Codex auth')!
    expect(auth).toBeDefined()
    expect(auth.status).toBe('ok')
    expect(auth.message).toMatch(/valid/)
  })

  it('parses version from omp/X.Y.Z format', () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which omp')) return '/usr/local/bin/omp\n'
      if (cmd.includes('omp --version')) return 'omp/16.1.16\n'
      throw new Error(`unexpected command: ${cmd}`)
    })

    const results = checkOhmypi(false)
    const omp = results.find((r) => r.name === 'oh-my-pi (omp)')!
    expect(omp.status).toBe('ok')
    expect(omp.message).toContain('16.1.16')
  })
})
