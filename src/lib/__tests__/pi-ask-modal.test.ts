/**
 * PAN-3766 follow-up — answerPiAskModal drives a pi ask modal with keystrokes.
 * All tmux/transcript access is injected; fixtures mirror a captured live pane.
 */
import { describe, expect, it } from 'vitest'

import { answerPiAskModal, type PiAskModalDeps } from '../pi-ask-modal.js'
import type { PendingInputsScan } from '../agent-enrichment.js'

const TOOL_ID = '5c5bdd4c-1c9d-4a5a-ad52-cf80395bb040|fc_tmp_j1iziob6xvp'

const QUESTION = 'Which battle should I stage so it\'s ready to trigger?'

const OPTIONS = [
  { label: '1 · Camp battle', description: 'Easiest start.' },
  { label: '2 · Strike (offline duel)', description: 'Already half-staged.' },
  { label: '3 · Raid (theft)', description: 'Steal from the stockpile.' },
]

function boxedPane(cursor: number | 'other' = 1): string {
  const mark = (pos: number | 'other', value: number | 'other') => (pos === value ? '❯ ○' : '  ○')
  return `
 ⠙ Choosing which battle to stage live ⟦esc⟧
╭─ Ask ─────────────────────────────╮
│ ${QUESTION} │
├───────────────────────────────────┤
│ ${mark(cursor, 1)} 1 · Camp battle │
│ ${mark(cursor, 2)} 2 · Strike (offline duel) │
│ ${mark(cursor, 3)} 3 · Raid (theft) │
│ ${mark(cursor, 'other')} Other (type your own) │
├───────────────────────────────────┤
│ Enter select · n note · ↑/↓ move · Esc cancel │
╰───────────────────────────────────╯
`
}

function makeScan(overrides: Partial<PendingInputsScan> = {}): PendingInputsScan {
  return {
    askUserQuestions: [
      {
        toolId: TOOL_ID,
        timestamp: '2026-08-22T12:42:54.210Z',
        questions: [{ question: QUESTION, header: 'Battle type', multiSelect: false, options: OPTIONS }],
      },
    ],
    enterPlanModeOpen: false,
    exitPlanModePending: false,
    ...overrides,
  }
}

interface Harness {
  deps: PiAskModalDeps
  keys: string[]
  texts: string[]
  setPaneAfterAnswer: (pane: string) => void
}

function makeHarness(opts: {
  pane?: string
  paneAfterAnswer?: string
  scan?: PendingInputsScan | null
  sessionAlive?: boolean
} = {}): Harness {
  const keys: string[] = []
  const texts: string[] = []
  let pane = opts.pane ?? boxedPane(1)
  let answered = false
  const paneAfter = opts.paneAfterAnswer ?? 'Agent proceeds with the answer.\n'
  return {
    keys,
    texts,
    setPaneAfterAnswer: (p) => { pane = p },
    deps: {
      sessionExists: async () => opts.sessionAlive ?? true,
      resolveTranscript: async () => (opts.scan === null ? null : '/fake/session.jsonl'),
      scanTranscript: async () => opts.scan ?? makeScan(),
      capture: async () => (answered ? paneAfter : pane),
      sendKey: async (_s, key) => {
        keys.push(key)
        if (key === 'Enter') answered = true
      },
      sendText: async (_s, text) => { texts.push(text) },
      sleep: async () => {},
    },
  }
}

describe('answerPiAskModal (PAN-3766)', () => {
  it('moves the cursor from option 1 to option 3 and confirms with Enter', async () => {
    const h = makeHarness()
    const result = await answerPiAskModal('conv-x', { toolUseId: TOOL_ID, answers: ['3 · Raid (theft)'] }, h.deps)

    expect(result.body).toMatchObject({ ok: true, answeredLabel: '3 · Raid (theft)' })
    expect(h.keys).toEqual(['Down', 'Down', 'Enter'])
    expect(h.texts).toEqual([])
  })

  it('moves Up when the cursor sits below the target option', async () => {
    const h = makeHarness({ pane: boxedPane(3) })
    const result = await answerPiAskModal('conv-x', { toolUseId: TOOL_ID, answers: ['1 · Camp battle'] }, h.deps)

    expect(result.body).toMatchObject({ ok: true })
    expect(h.keys).toEqual(['Up', 'Up', 'Enter'])
  })

  it('sends no navigation keys when the cursor is already on the target', async () => {
    const h = makeHarness({ pane: boxedPane(2) })
    const result = await answerPiAskModal('conv-x', { toolUseId: TOOL_ID, answers: ['2 · Strike (offline duel)'] }, h.deps)

    expect(result.body).toMatchObject({ ok: true })
    expect(h.keys).toEqual(['Enter'])
  })

  it('routes a free-text answer through the Other input', async () => {
    const h = makeHarness({ pane: boxedPane(1) })
    const result = await answerPiAskModal('conv-x', { toolUseId: TOOL_ID, answers: ['Stage none, explain more first'] }, h.deps)

    expect(result.body).toMatchObject({ ok: true })
    expect(h.keys).toEqual(['Down', 'Down', 'Down', 'Enter', 'Enter'])
    expect(h.texts).toEqual(['Stage none, explain more first'])
  })

  it('409s when the ask is no longer pending in the transcript', async () => {
    const h = makeHarness({ scan: makeScan({ askUserQuestions: [] }) })
    const result = await answerPiAskModal('conv-x', { toolUseId: TOOL_ID, answers: ['1 · Camp battle'] }, h.deps)

    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ code: 'ask-gone' })
    expect(h.keys).toEqual([])
  })

  it('409s when the modal is no longer on screen', async () => {
    const h = makeHarness({ pane: 'Agent is working on something else.\n' })
    const result = await answerPiAskModal('conv-x', { toolUseId: TOOL_ID, answers: ['1 · Camp battle'] }, h.deps)

    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ code: 'modal-gone' })
    expect(h.keys).toEqual([])
  })

  it('409s when the on-screen question differs from the transcript', async () => {
    const pane = boxedPane(1).replace(QUESTION, 'A completely different question?')
    const h = makeHarness({ pane })
    const result = await answerPiAskModal('conv-x', { toolUseId: TOOL_ID, answers: ['1 · Camp battle'] }, h.deps)

    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ code: 'modal-changed' })
  })

  it('409s when the cursor cannot be parsed', async () => {
    const pane = boxedPane(1).replace('❯ ○ 1 · Camp battle', '  ○ 1 · Camp battle')
    const h = makeHarness({ pane })
    const result = await answerPiAskModal('conv-x', { toolUseId: TOOL_ID, answers: ['1 · Camp battle'] }, h.deps)

    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ code: 'cursor-unknown' })
  })

  it('409s when the modal is still on screen after the keystrokes', async () => {
    const h = makeHarness({ paneAfterAnswer: boxedPane(1) })
    const result = await answerPiAskModal('conv-x', { toolUseId: TOOL_ID, answers: ['1 · Camp battle'] }, h.deps)

    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ code: 'delivery-unconfirmed' })
  })

  it('409s a multi-question ask rather than guessing the navigation', async () => {
    const scan = makeScan()
    scan.askUserQuestions[0]!.questions.push({ question: 'Second?', header: 'Q2', multiSelect: false, options: OPTIONS })
    const h = makeHarness({ scan })
    const result = await answerPiAskModal('conv-x', { toolUseId: TOOL_ID, answers: ['1 · Camp battle'] }, h.deps)

    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ code: 'multi-question-unsupported' })
    expect(h.keys).toEqual([])
  })

  it('409s when the session is not running', async () => {
    const h = makeHarness({ sessionAlive: false })
    const result = await answerPiAskModal('conv-x', { toolUseId: TOOL_ID, answers: ['1 · Camp battle'] }, h.deps)

    expect(result.status).toBe(409)
    expect(h.keys).toEqual([])
  })
})
