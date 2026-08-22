/**
 * PAN-3766 — scanPendingInputsPromise must recognize ohmypi transcripts. Pi's
 * `ask` tool is the AskUserQuestion analogue: an assistant `toolCall` content
 * item opens the question, a `toolResult` message (including pi's synthetic
 * interrupt-skip) resolves it. Detection is per-line, so these fixtures use the
 * real pi envelope shapes captured from a live conversation transcript.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { scanPendingInputsPromise } from '../agent-enrichment.js'

const ASK_ID = '5c5bdd4c-1c9d-4a5a-ad52-cf80395bb040|fc_tmp_j1iziob6xvp'

function piAssistantAsk(id: string = ASK_ID): string {
  return JSON.stringify({
    type: 'message',
    id: '2bee36ad',
    parentId: '1b60449a',
    timestamp: '2026-08-22T12:42:54.210Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '…' },
        { type: 'text', text: 'Pick one.' },
        {
          type: 'toolCall',
          id,
          name: 'ask',
          arguments: {
            i: 'Choosing which battle to stage live',
            questions: [
              {
                header: 'Battle type',
                id: 'battle',
                multiSelect: false,
                question: 'Which battle should I stage so it is ready to trigger?',
                options: [
                  { label: '1 · Camp battle', description: 'Easiest start.' },
                  { label: '2 · Strike (offline duel)', description: 'Already half-staged.' },
                ],
              },
            ],
          },
        },
      ],
    },
  })
}

function piToolResult(id: string = ASK_ID, text = '1 · Camp battle'): string {
  return JSON.stringify({
    type: 'message',
    id: '7298ee53',
    parentId: 'c3019675',
    timestamp: '2026-08-22T12:43:10.000Z',
    message: {
      role: 'toolResult',
      toolCallId: id,
      toolName: 'ask',
      content: [{ type: 'text', text }],
      timestamp: 1787364257157,
    },
  })
}

function piSyntheticSkip(id: string = ASK_ID): string {
  return JSON.stringify({
    type: 'message',
    id: '7298ee54',
    timestamp: '2026-08-22T12:43:10.000Z',
    message: {
      role: 'toolResult',
      toolCallId: id,
      toolName: 'ask',
      content: [{ type: 'text', text: 'Skipped due to queued user message. …' }],
      details: { __synthetic: true, source: 'interrupt_skipped', executed: false },
      isError: true,
      timestamp: 1787364257157,
    },
  })
}

function claudeAskUserQuestion(): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-22T12:00:00.000Z',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_claude_auq',
          name: 'AskUserQuestion',
          input: {
            questions: [
              {
                question: 'Which approach?',
                header: 'Approach',
                multiSelect: false,
                options: [{ label: 'A', description: 'first' }],
              },
            ],
          },
        },
      ],
    },
  })
}

describe('scanPendingInputsPromise — ohmypi transcripts (PAN-3766)', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pi-scan-'))
    file = join(dir, 'session.jsonl')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('surfaces a pending pi ask with its questions mapped to the AUQ shape', async () => {
    writeFileSync(file, `${piAssistantAsk()}\n`)
    const scan = await scanPendingInputsPromise(file)

    expect(scan.askUserQuestions).toHaveLength(1)
    const pending = scan.askUserQuestions[0]
    expect(pending.toolId).toBe(ASK_ID)
    expect(pending.timestamp).toBe('2026-08-22T12:42:54.210Z')
    expect(pending.questions).toEqual([
      {
        question: 'Which battle should I stage so it is ready to trigger?',
        header: 'Battle type',
        multiSelect: false,
        options: [
          { label: '1 · Camp battle', description: 'Easiest start.' },
          { label: '2 · Strike (offline duel)', description: 'Already half-staged.' },
        ],
      },
    ])
  })

  it('does not report an ask the operator answered', async () => {
    writeFileSync(file, `${piAssistantAsk()}\n${piToolResult()}\n`)
    const scan = await scanPendingInputsPromise(file)
    expect(scan.askUserQuestions).toHaveLength(0)
  })

  it('treats pi’s synthetic interrupt-skip toolResult as resolved', async () => {
    writeFileSync(file, `${piAssistantAsk()}\n${piSyntheticSkip()}\n`)
    const scan = await scanPendingInputsPromise(file)
    expect(scan.askUserQuestions).toHaveLength(0)
  })

  it('reports only the unanswered ask when one was resolved and a later one is open', async () => {
    const laterId = 'aaaa1111-0000-4000-8000-000000000000|fc_tmp_later'
    writeFileSync(
      file,
      `${piAssistantAsk()}\n${piToolResult()}\n${piAssistantAsk(laterId)}\n`,
    )
    const scan = await scanPendingInputsPromise(file)
    expect(scan.askUserQuestions.map(q => q.toolId)).toEqual([laterId])
  })

  it('still detects claude AskUserQuestion entries in the same pass', async () => {
    writeFileSync(file, `${claudeAskUserQuestion()}\n`)
    const scan = await scanPendingInputsPromise(file)
    expect(scan.askUserQuestions.map(q => q.toolId)).toEqual(['toolu_claude_auq'])
  })

  it('ignores non-ask tool calls and malformed lines', async () => {
    const bashCall = JSON.stringify({
      type: 'message',
      timestamp: '2026-08-22T12:00:00.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'xyz|fc_tmp_1', name: 'bash', arguments: { command: 'ls' } }],
      },
    })
    writeFileSync(file, `${bashCall}\nnot json\n${piAssistantAsk()}\n`)
    const scan = await scanPendingInputsPromise(file)
    expect(scan.askUserQuestions.map(q => q.toolId)).toEqual([ASK_ID])
  })
})
