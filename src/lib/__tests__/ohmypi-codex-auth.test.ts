import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'

// Tests run with HOME overridden so we never touch the real ~/.omp.
// Compute FAKE_HOME using real os.tmpdir() BEFORE vi.mock re-routes it.
const FAKE_HOME = join(tmpdir(), `ohmypi-codex-auth-test-${process.pid}`)
const FAKE_AUTH = join(FAKE_HOME, '.omp', 'agent', 'auth.json')

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => FAKE_HOME }
})

import {
  getOhmypiAuthPath,
  readOhmypiCodexCredential,
  getOhmypiCodexAuthStatus,
} from '../ohmypi-codex-auth.js'

describe('ohmypi-codex-auth (PAN-1989)', () => {
  beforeEach(() => {
    mkdirSync(join(FAKE_HOME, '.omp', 'agent'), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(FAKE_AUTH)) rmSync(FAKE_AUTH)
  })

  it('AC: getOhmypiAuthPath returns ~/.omp/agent/auth.json', () => {
    expect(getOhmypiAuthPath()).toBe(join(FAKE_HOME, '.omp', 'agent', 'auth.json'))
  })

  it('AC: returns null when auth.json does not exist', () => {
    expect(readOhmypiCodexCredential()).toBeNull()
  })

  it('AC: reads a valid openai-codex credential from auth.json', () => {
    const cred = {
      'openai-codex': {
        type: 'oauth',
        access: 'tok-abc',
        refresh: 'ref-xyz',
        expires: Date.now() + 3_600_000,
        accountId: 'acct-1',
      },
    }
    writeFileSync(FAKE_AUTH, JSON.stringify(cred), { mode: 0o600 })
    const result = readOhmypiCodexCredential()
    expect(result).not.toBeNull()
    expect(result!.access).toBe('tok-abc')
    expect(result!.refresh).toBe('ref-xyz')
  })

  it('AC: getOhmypiCodexAuthStatus returns ok for a non-expired token', async () => {
    const cred = {
      'openai-codex': {
        type: 'oauth',
        access: 'tok-fresh',
        refresh: 'ref-fresh',
        expires: Date.now() + 3_600_000,
        accountId: 'acct-1',
      },
    }
    writeFileSync(FAKE_AUTH, JSON.stringify(cred), { mode: 0o600 })
    const status = await getOhmypiCodexAuthStatus()
    expect(status.status).toBe('ok')
  })

  it('AC: getOhmypiCodexAuthStatus returns missing when no credential is present', async () => {
    const status = await getOhmypiCodexAuthStatus()
    expect(status.status).toBe('missing')
  })

  it('AC: does not throw when omp OAuth module is missing (graceful degradation)', async () => {
    // Expired token; omp is not on PATH so loadOhmypiCodexOAuth returns null.
    const cred = {
      'openai-codex': {
        type: 'oauth',
        access: 'tok-old',
        refresh: 'ref-old',
        expires: Date.now() - 3_600_000,
        accountId: 'acct-1',
      },
    }
    writeFileSync(FAKE_AUTH, JSON.stringify(cred), { mode: 0o600 })
    // Must not throw; must return a valid status union value.
    const status = await getOhmypiCodexAuthStatus({ refreshIfExpired: true })
    expect(['expired', 'unavailable', 'ok']).toContain(status.status)
  })
})
