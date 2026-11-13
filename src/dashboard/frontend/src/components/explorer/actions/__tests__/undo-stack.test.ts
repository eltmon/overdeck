import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanRpcError } from '@overdeck/contracts'

vi.mock('../../../../lib/wsTransport', () => ({ getTransport: () => ({}) }))

import {
  MAX_UNDO_OPS,
  clearUndoHistory,
  commitOp,
  hasRedo,
  hasUndo,
  redo,
  undo,
  undoEntry,
  type UndoStep,
} from '../undo-stack'

const ROOT = 'issue:PAN-1'

function recorder() {
  const calls: string[] = []
  const step = (name: string): UndoStep => ({
    undo: vi.fn(async () => {
      calls.push(`undo ${name}`)
    }),
    redo: vi.fn(async () => {
      calls.push(`redo ${name}`)
    }),
  })
  return { calls, step }
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

afterEach(() => {
  clearUndoHistory()
})

describe('undo-stack', () => {
  it('undo runs the steps last to first and returns the label', async () => {
    const { calls, step } = recorder()
    commitOp(ROOT, { label: 'delete of 3 items', steps: [step('a'), step('b'), step('c')] })
    await expect(undo(ROOT)).resolves.toBe('delete of 3 items')
    expect(calls).toEqual(['undo c', 'undo b', 'undo a'])
    expect(hasUndo(ROOT)).toBe(false)
    expect(hasRedo(ROOT)).toBe(true)
  })

  it('redo runs the steps first to last', async () => {
    const { calls, step } = recorder()
    commitOp(ROOT, { label: 'move of 2 items', steps: [step('a'), step('b')] })
    await undo(ROOT)
    calls.length = 0
    await expect(redo(ROOT)).resolves.toBe('move of 2 items')
    expect(calls).toEqual(['redo a', 'redo b'])
    expect(hasUndo(ROOT)).toBe(true)
    expect(hasRedo(ROOT)).toBe(false)
  })

  it('returns null when there is nothing to undo or redo', async () => {
    await expect(undo(ROOT)).resolves.toBeNull()
    await expect(redo(ROOT)).resolves.toBeNull()
  })

  it('a new commit clears the redo list', async () => {
    const { step } = recorder()
    commitOp(ROOT, { label: 'one', steps: [step('a')] })
    await undo(ROOT)
    expect(hasRedo(ROOT)).toBe(true)
    commitOp(ROOT, { label: 'two', steps: [step('b')] })
    expect(hasRedo(ROOT)).toBe(false)
  })

  it('an op with no steps is not stored', () => {
    expect(commitOp(ROOT, { label: 'empty', steps: [] })).toBe('')
    expect(hasUndo(ROOT)).toBe(false)
  })

  it('the 51st commit drops the oldest op', async () => {
    const { step } = recorder()
    for (let i = 1; i <= MAX_UNDO_OPS + 1; i += 1) commitOp(ROOT, { label: `op ${i}`, steps: [step(String(i))] })
    const labels: string[] = []
    for (let label = await undo(ROOT); label !== null; label = await undo(ROOT)) labels.push(label)
    expect(labels).toHaveLength(MAX_UNDO_OPS)
    expect(labels.at(-1)).toBe('op 2')
  })

  it('a refusal part-way through undo keeps the op, and a retry runs only the remaining steps', async () => {
    const { calls, step } = recorder()
    const middle = step('b')
    vi.mocked(middle.undo).mockRejectedValueOnce(new PanRpcError({ code: 'ALREADY_EXISTS', message: 'b exists' }))
    commitOp(ROOT, { label: 'delete of 3 items', steps: [step('a'), middle, step('c')] })

    await expect(undo(ROOT)).rejects.toThrow('b exists')
    expect(calls).toEqual(['undo c'])
    expect(hasUndo(ROOT)).toBe(true)
    expect(hasRedo(ROOT)).toBe(false)

    await expect(undo(ROOT)).resolves.toBe('delete of 3 items')
    expect(calls).toEqual(['undo c', 'undo b', 'undo a'])
  })

  it('a refusal read from a plain error code also keeps the op', async () => {
    const { step } = recorder()
    const failing = step('a')
    vi.mocked(failing.undo).mockRejectedValueOnce(codedError('NOT_FOUND'))
    commitOp(ROOT, { label: 'upload of a', steps: [failing] })
    await expect(undo(ROOT)).rejects.toThrow('NOT_FOUND')
    expect(hasUndo(ROOT)).toBe(true)
  })

  it('a refusal during redo puts the op back on the redo list', async () => {
    const { step } = recorder()
    const failing = step('a')
    commitOp(ROOT, { label: 'rename of a', steps: [failing] })
    await undo(ROOT)
    vi.mocked(failing.redo).mockRejectedValueOnce(codedError('INVALID_TARGET'))
    await expect(redo(ROOT)).rejects.toThrow('INVALID_TARGET')
    expect(hasRedo(ROOT)).toBe(true)
    expect(hasUndo(ROOT)).toBe(false)
  })

  it('any other error drops the op from history', async () => {
    const { step } = recorder()
    const failing = step('a')
    vi.mocked(failing.undo).mockRejectedValueOnce(new Error('socket closed'))
    commitOp(ROOT, { label: 'new file a', steps: [failing] })
    await expect(undo(ROOT)).rejects.toThrow('socket closed')
    expect(hasUndo(ROOT)).toBe(false)
    expect(hasRedo(ROOT)).toBe(false)
  })

  it('undoEntry on the top op behaves as undo', async () => {
    const { step } = recorder()
    const id = commitOp(ROOT, { label: 'top', steps: [step('a')] })
    await expect(undoEntry(ROOT, id)).resolves.toBe('top')
    expect(hasRedo(ROOT)).toBe(true)
  })

  it('undoEntry on an older op undoes it and leaves redo unchanged', async () => {
    const { calls, step } = recorder()
    const older = commitOp(ROOT, { label: 'older', steps: [step('a')] })
    commitOp(ROOT, { label: 'newer', steps: [step('b')] })

    await expect(undoEntry(ROOT, older)).resolves.toBe('older')
    expect(calls).toEqual(['undo a'])
    expect(hasRedo(ROOT)).toBe(false)

    await expect(undo(ROOT)).resolves.toBe('newer')
    await expect(undo(ROOT)).resolves.toBeNull()
  })

  it('undoEntry returns null for an op no longer in history', async () => {
    const { step } = recorder()
    const id = commitOp(ROOT, { label: 'gone', steps: [step('a')] })
    await undo(ROOT)
    await expect(undoEntry(ROOT, id)).resolves.toBeNull()
  })

  it('roots are independent', async () => {
    const { calls, step } = recorder()
    commitOp(ROOT, { label: 'issue op', steps: [step('a')] })
    commitOp('workspace:w1', { label: 'workspace op', steps: [step('b')] })
    await expect(undo('workspace:w1')).resolves.toBe('workspace op')
    expect(calls).toEqual(['undo b'])
    expect(hasUndo(ROOT)).toBe(true)
    expect(hasUndo('workspace:w1')).toBe(false)
  })
})
