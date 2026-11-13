// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: src/renderer/src/components/right-sidebar/file-explorer/mutations/fileExplorerUndoRedo.ts @ c6b9ac9549b
/**
 * Explorer undo and redo history (PAN-5190, FR-E7, D-E4, D-E9, NFR-E5).
 *
 * One `{ past, future }` pair per explorer root, kept in memory only, so a
 * page reload clears it. An op is one user action made of one or more steps;
 * each step is a reversible server call pair. Each stored op remembers how
 * many of its steps are applied (`done`), so an op whose undo stopped part-way
 * resumes where it stopped.
 *
 * Unlike Orca's single-step ops, a failure is judged per op: a refusal
 * (`REFUSAL_CODES`) guarantees the failing call wrote nothing, so the op goes
 * back on the stack it came from and can be retried. Any other error leaves
 * the server state unknown, so the op is dropped; a replay could overwrite
 * newer work. Either way the error is rethrown for the caller's toast.
 */

import { explorerErrorCode } from '../explorer-rpc'

export const MAX_UNDO_OPS = 50
export const REFUSAL_CODES: ReadonlySet<string> = new Set(['ALREADY_EXISTS', 'NOT_FOUND', 'INVALID_TARGET'])

export interface UndoStep {
  undo(): Promise<void>
  redo(): Promise<void>
}

export interface UndoOp {
  label: string
  steps: readonly UndoStep[]
}

interface StoredOp {
  id: string
  label: string
  steps: readonly UndoStep[]
  /** How many steps, counted from the first, are currently applied. */
  done: number
}

interface RootHistory {
  past: StoredOp[]
  future: StoredOp[]
}

const histories = new Map<string, RootHistory>()
let nextOpId = 1

function historyFor(rootId: string): RootHistory {
  let history = histories.get(rootId)
  if (!history) {
    history = { past: [], future: [] }
    histories.set(rootId, history)
  }
  return history
}

function errorCode(error: unknown): string | undefined {
  const rpcCode = explorerErrorCode(error)
  if (rpcCode) return rpcCode
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown }
    if (typeof code === 'string') return code
  }
  return undefined
}

function isRefusal(error: unknown): boolean {
  const code = errorCode(error)
  return code !== undefined && REFUSAL_CODES.has(code)
}

/** Run the applied steps last to first, decrementing `done` after each success. */
async function runUndo(op: StoredOp): Promise<void> {
  while (op.done > 0) {
    await op.steps[op.done - 1].undo()
    op.done -= 1
  }
}

/** Run the unapplied steps first to last, incrementing `done` after each success. */
async function runRedo(op: StoredOp): Promise<void> {
  while (op.done < op.steps.length) {
    await op.steps[op.done].redo()
    op.done += 1
  }
}

/**
 * Record a completed op. Returns its id, or `''` when the op has no steps
 * (nothing is stored). Clears the root's redo list and drops the oldest op
 * beyond `MAX_UNDO_OPS`.
 */
export function commitOp(rootId: string, op: UndoOp): string {
  if (op.steps.length === 0) return ''
  const history = historyFor(rootId)
  const id = `op-${nextOpId++}`
  history.past.push({ id, label: op.label, steps: [...op.steps], done: op.steps.length })
  if (history.past.length > MAX_UNDO_OPS) history.past.shift()
  history.future.length = 0
  return id
}

/** Undo the root's last op. Returns its label, or null when there is nothing to undo. */
export async function undo(rootId: string): Promise<string | null> {
  const history = historyFor(rootId)
  const op = history.past.pop()
  if (!op) return null
  try {
    await runUndo(op)
  } catch (error) {
    if (isRefusal(error)) history.past.push(op)
    throw error
  }
  history.future.push(op)
  return op.label
}

/** Redo the root's last undone op. Returns its label, or null when there is nothing to redo. */
export async function redo(rootId: string): Promise<string | null> {
  const history = historyFor(rootId)
  const op = history.future.pop()
  if (!op) return null
  try {
    await runRedo(op)
  } catch (error) {
    if (isRefusal(error)) history.future.push(op)
    throw error
  }
  history.past.push(op)
  return op.label
}

/**
 * Undo one specific op, for a toast's Undo action (D-E9). The top op behaves
 * as `undo(rootId)`. An older op is undone and removed from history without
 * going on the redo list, because redoing out of order is not defined.
 * Returns the label, or null when the op is no longer in the undo history.
 */
export async function undoEntry(rootId: string, opId: string): Promise<string | null> {
  const history = historyFor(rootId)
  const index = history.past.findIndex((op) => op.id === opId)
  if (index === -1) return null
  if (index === history.past.length - 1) return undo(rootId)
  const [op] = history.past.splice(index, 1)
  try {
    await runUndo(op)
  } catch (error) {
    if (isRefusal(error)) history.past.splice(Math.min(index, history.past.length), 0, op)
    throw error
  }
  return op.label
}

export function hasUndo(rootId: string): boolean {
  return (histories.get(rootId)?.past.length ?? 0) > 0
}

export function hasRedo(rootId: string): boolean {
  return (histories.get(rootId)?.future.length ?? 0) > 0
}

/** Clear one root's history, or every root's when called with no argument (tests). */
export function clearUndoHistory(rootId?: string): void {
  if (rootId === undefined) histories.clear()
  else histories.delete(rootId)
}
