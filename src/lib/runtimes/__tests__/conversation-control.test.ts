import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  conversationControlPaths,
  writeConversationControlCommand,
} from '../conversation-control.js'

function makeFakeHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'pan-conversation-control-'))
  return {
    home,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  }
}

describe('writeConversationControlCommand', () => {
  let h: ReturnType<typeof makeFakeHome>
  beforeEach(() => { h = makeFakeHome() })
  afterEach(() => h.cleanup())

  it('writes exactly one command file with private permissions', async () => {
    const file = await writeConversationControlCommand(
      'conv-abc',
      { id: 'cmd-1', type: 'steer', message: 'keep going', source: 'operator' },
      h.home,
    )
    const paths = conversationControlPaths('conv-abc', h.home)

    expect(statSync(paths.controlDir).mode & 0o777).toBe(0o700)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readdirSync(paths.controlDir)).toEqual([basename(file)])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      id: 'cmd-1',
      type: 'steer',
      message: 'keep going',
      source: 'operator',
    })
  })
})
