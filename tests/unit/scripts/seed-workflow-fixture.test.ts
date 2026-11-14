import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { REFUSAL_MESSAGE, seedWorkflowFixture } from '../../../scripts/dev/seed-workflow-fixture.js'
import { listConversations } from '../../../src/lib/overdeck/conversations.js'
import { getCachedMessages } from '../../../src/lib/overdeck/conversation-reads.js'
import { claudeProjectDir, claudeProjectsRoot } from '../../../src/lib/runtimes/storage/claude-code.js'

// PAN-5287 §6.9: the shared workflow fixture, against real git and the real
// transcript parser. OVERDECK_HOME is already a per-worker temp dir
// (tests/setup/overdeck-home.ts); `home` is a temp dir too.

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: vi.fn(actual.homedir) }
})

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd })
    return { stdout: stdout.trim(), code: 0 }
  } catch (error) {
    return { stdout: '', code: (error as { code?: number }).code ?? 1 }
  }
}

afterEach(() => {
  vi.mocked(os.homedir).mockRestore?.()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('seedWorkflowFixture', () => {
  it('creates the fixture repo, project, conversations and transcripts', async () => {
    const root = tempDir('wfx-root-')
    const home = tempDir('wfx-home-')
    const now = new Date()
    now.setHours(15, 0, 0, 0)
    const result = await seedWorkflowFixture({ root, home, now })
    const repo = result.repoPath

    expect((await git(repo, ['rev-list', '--count', 'origin/main..main'])).stdout).toBe('1')
    expect((await git(repo, ['log', '-1', '--format=%(trailers:key=Overdeck-Conversation,valueonly)'])).stdout).toBe(
      'conv-fixture-1',
    )
    const status = (await git(repo, ['status', '--porcelain'])).stdout
    expect(status).toContain('docs/shared.md')
    expect(status).not.toContain('build/')
    expect((await git(repo, ['check-ignore', 'build/output.txt'])).code).toBe(0)

    const fixture1 = listConversations().find((c) => c.name === 'fixture-1')
    expect(fixture1?.tmuxSession).toBe('conv-fixture-1')

    const dir = claudeProjectDir(repo, claudeProjectsRoot(home))
    const transcriptFile = join(dir, `${fixture1?.claudeSessionId}.jsonl`)
    expect(readdirSync(dir)).toContain(`${fixture1?.claudeSessionId}.jsonl`)
    const parsed = await getCachedMessages(transcriptFile, false)
    const editedFiles = [...(parsed.fileEditsByAssistantId?.values() ?? [])].flat().map((edit) => edit.filePath)
    expect(editedFiles.some((path) => path.endsWith('docs/shared.md'))).toBe(true)
    const shortSha = result.shas.preTrailer.slice(0, 7)
    expect(parsed.workLog.some((entry) => entry.result?.includes(shortSha))).toBe(true)
  })

  it("refuses to seed the operator's real Overdeck home", async () => {
    const fakeHome = tempDir('wfx-real-')
    mkdirSync(join(fakeHome, '.overdeck'))
    vi.mocked(os.homedir).mockReturnValue(fakeHome)
    const saved = process.env.OVERDECK_HOME
    process.env.OVERDECK_HOME = join(fakeHome, '.overdeck')
    try {
      await expect(seedWorkflowFixture({ root: tempDir('wfx-root-'), home: fakeHome })).rejects.toThrow(REFUSAL_MESSAGE)
    } finally {
      process.env.OVERDECK_HOME = saved
    }
  })

  it('refuses to seed without OVERDECK_HOME', async () => {
    const saved = process.env.OVERDECK_HOME
    delete process.env.OVERDECK_HOME
    try {
      await expect(seedWorkflowFixture({ root: tempDir('wfx-root-'), home: tempDir('wfx-home-') })).rejects.toThrow(
        REFUSAL_MESSAGE,
      )
    } finally {
      process.env.OVERDECK_HOME = saved
    }
  })
})
