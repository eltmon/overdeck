/**
 * pi runtime (PAN-5212): registration and the launch it generates, mirroring
 * the ohmypi runtime tests. tmux and the binary lookup are mocked, so no pane
 * and no real `pi` process start.
 */
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  prepareHarnessLaunch: vi.fn(async () => ({
    binaryPath: '/home/test/.nvm/bin/pi',
    pathExport: `export PATH='/home/test/.nvm/bin':"$PATH"`,
  })),
  createSession: vi.fn(),
}))

vi.mock('../../harness-binary.js', () => ({ prepareHarnessLaunch: mocks.prepareHarnessLaunch }))
vi.mock('../../tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tmux.js')>()),
  createSession: mocks.createSession,
}))

import { OhmypiRuntimeSync } from '../ohmypi.js'
import { createPiRuntimeSync } from '../pi.js'
import { getRuntime } from '../index.js'

function withFakeHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'pan-pi-runtime-'))
  const originalHome = process.env['HOME']
  const originalOverdeckHome = process.env.OVERDECK_HOME
  const originalPiDir = process.env.PI_CODING_AGENT_DIR
  process.env['HOME'] = home
  process.env.OVERDECK_HOME = join(home, '.overdeck')
  delete process.env.PI_CODING_AGENT_DIR
  return {
    home,
    cleanup: () => {
      if (originalHome === undefined) delete process.env['HOME']
      else process.env['HOME'] = originalHome
      if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME
      else process.env.OVERDECK_HOME = originalOverdeckHome
      if (originalPiDir !== undefined) process.env.PI_CODING_AGENT_DIR = originalPiDir
      rmSync(home, { recursive: true, force: true })
    },
  }
}

describe('pi runtime registration (PAN-5212)', () => {
  it('the global registry serves pi with the pi binary behavior', () => {
    const runtime = getRuntime('pi')
    expect(runtime?.name).toBe('pi')
    expect(runtime?.getHarnessBehavior().executableName).toBe('pi')
    expect(getRuntime('ohmypi')?.getHarnessBehavior().executableName).toBe('omp')
  })

  it('createPiRuntimeSync builds the shared pi-family adapter for pi', () => {
    const runtime = createPiRuntimeSync()
    expect(runtime).toBeInstanceOf(OhmypiRuntimeSync)
    expect(runtime.name).toBe('pi')
  })
})

describe('pi runtime spawnAgent (PAN-5212)', () => {
  let h: ReturnType<typeof withFakeHome>
  beforeEach(() => {
    h = withFakeHome()
    mocks.createSession.mockReset()
    mocks.createSession.mockReturnValue(Effect.void)
    mocks.prepareHarnessLaunch.mockClear()
  })
  afterEach(() => h.cleanup())

  function agentDir(agentId: string): string {
    const dir = join(h.home, '.overdeck', 'agents', agentId)
    mkdirSync(join(dir, 'sessions'), { recursive: true })
    // Pre-create the extension's ready marker so spawnAgent does not wait.
    writeFileSync(join(dir, 'ready.json'), JSON.stringify({ sessionId: 'irrelevant' }))
    return dir
  }

  it('launches `pi --mode rpc` with --no-approve, a provider-qualified model and --session resume', async () => {
    const agentId = 'agent-pi-resume'
    const dir = agentDir(agentId)
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify([
      { sessionId: 'sess-pi-4242', at: '2026-11-13T00:00:00.000Z', source: 'session-start' },
    ]))

    const agent = await createPiRuntimeSync().spawnAgent({
      agentId,
      workspace: h.home,
      model: 'gemini-3-flash-preview',
      piExtensionPath: '/tmp/fake-pi-extension/dist/index.js',
    } as Parameters<OhmypiRuntimeSync['spawnAgent']>[0])

    expect(mocks.prepareHarnessLaunch).toHaveBeenCalledWith('pi')
    expect(agent.runtime).toBe('pi')
    const launcher = readFileSync(join(dir, 'pi-launcher.sh'), 'utf-8')
    expect(launcher).toMatch(/(^|\s)pi --mode rpc /m)
    expect(launcher).not.toMatch(/\bomp\b --mode/)
    expect(launcher).toContain('--no-approve')
    expect(launcher).toContain("--model 'google/gemini-3-flash-preview'")
    expect(launcher).toContain("--session 'sess-pi-4242'")
    expect(launcher).not.toContain('--resume')
    expect(launcher).toContain("--extension '/tmp/fake-pi-extension/dist/index.js'")
    expect(mocks.createSession).toHaveBeenCalledWith(agentId, h.home, `bash ${join(dir, 'pi-launcher.sh')}`, expect.anything())
  })

  it('provisions models missing from pi\'s catalog into ~/.pi/agent/models.json', async () => {
    const agentId = 'agent-pi-provision'
    agentDir(agentId)

    await createPiRuntimeSync().spawnAgent({
      agentId,
      workspace: h.home,
      model: 'grok-build-0.1',
      piExtensionPath: '/tmp/fake-pi-extension/dist/index.js',
    } as Parameters<OhmypiRuntimeSync['spawnAgent']>[0])

    const registry = JSON.parse(readFileSync(join(h.home, '.pi', 'agent', 'models.json'), 'utf-8'))
    expect(registry.providers.xai.models.map((m: { id: string }) => m.id)).toContain('grok-build-0.1')
    // A built-in provider gets models only: no provider-level override of pi's own xai config.
    expect(registry.providers.xai.baseUrl).toBeUndefined()
    expect(registry.providers.xai.apiKey).toBeUndefined()
  })
})
