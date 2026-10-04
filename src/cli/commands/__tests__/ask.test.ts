import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/pipeline-notifier.js', () => ({ notifyPipeline: vi.fn() }))

const { runAskCommand } = await import('../ask.js')
const { readPipelineJournal } = await import('../../../lib/cloister/pipeline-journal.js')

let workspace: string
let log: ReturnType<typeof vi.fn>
let error: ReturnType<typeof vi.fn>
let exit: ReturnType<typeof vi.fn>

const deps = () => ({ getIssueWorkspacePath: () => workspace, log, error, exit })

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'pan-ask-'))
  log = vi.fn()
  error = vi.fn()
  exit = vi.fn(async () => undefined)
  vi.stubEnv('OVERDECK_AGENT_ID', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(workspace, { recursive: true, force: true })
})

describe('runAskCommand', () => {
  it('writes one operator.decision-requested entry with the options', async () => {
    await runAskCommand('PAN-9', 'Rotate the token?', { option: ['Yes', 'No'], context: 'Push protection hit.' }, deps())

    const entries = readPipelineJournal(workspace)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      type: 'operator.decision-requested',
      issueId: 'PAN-9',
      source: 'pan-ask',
      data: { agentId: 'agent-pan-9', question: 'Rotate the token?', options: ['Yes', 'No'], context: 'Push protection hit.' },
    })
    expect(exit).not.toHaveBeenCalled()
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/^Asked the operator \(od-[0-9a-f]{8}\)\./)
  })

  it('records the calling agent id when OVERDECK_AGENT_ID is set', async () => {
    vi.stubEnv('OVERDECK_AGENT_ID', 'agent-pan-9-slot')
    await runAskCommand('PAN-9', 'q?', { option: ['a', 'b'] }, deps())
    expect(readPipelineJournal(workspace)[0]?.data?.agentId).toBe('agent-pan-9-slot')
  })

  it('exits 1 and writes nothing with a single option', async () => {
    await runAskCommand('PAN-9', 'q?', { option: ['a'] }, deps())
    expect(exit).toHaveBeenCalledWith(1)
    expect(readPipelineJournal(workspace)).toHaveLength(0)
  })

  it('exits 1 when the workspace is missing', async () => {
    await runAskCommand('PAN-9', 'q?', { option: ['a', 'b'] }, { ...deps(), getIssueWorkspacePath: () => null })
    expect(error).toHaveBeenCalledWith('No workspace for PAN-9')
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('exits 1 on --withdraw with no open decision', async () => {
    await runAskCommand('PAN-9', undefined, { withdraw: true }, deps())
    expect(error).toHaveBeenCalledWith('No open decision for PAN-9')
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('appends operator.decision-withdrawn on --withdraw after an ask', async () => {
    await runAskCommand('PAN-9', 'q?', { option: ['a', 'b'] }, deps())
    const questionId = readPipelineJournal(workspace)[0]?.data?.questionId
    await runAskCommand('PAN-9', undefined, { withdraw: true }, deps())

    const entries = readPipelineJournal(workspace)
    expect(entries).toHaveLength(2)
    expect(entries[1]).toMatchObject({ type: 'operator.decision-withdrawn', data: { questionId } })
    expect(log).toHaveBeenLastCalledWith(`Withdrew ${questionId}.`)
    expect(exit).not.toHaveBeenCalled()
  })
})
