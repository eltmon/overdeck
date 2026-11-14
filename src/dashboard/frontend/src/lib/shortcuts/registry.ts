// The app-level keyboard shortcut registry (PAN-5287 §6.7, D-7, S-D5).
//
// Every app-level shortcut is declared here through `useShortcut` /
// `registerShortcut`; nothing else adds a window or document keydown listener
// for app shortcuts. `installShortcutListener` adds exactly two listeners:
//
// - a CAPTURE listener on window for `global` shortcuts. It runs before the
//   focused element's own handlers, so app keys win inside Monaco. It skips a
//   focus element inside `.xterm`.
// - a BUBBLE listener on window for `not-editing` shortcuts (focus is not in a
//   text field, a terminal or a code editor), plus `global` shortcuts whose focus
//   is inside `.xterm`. xterm cancels every key it turns into terminal input, so
//   a global key reaches the bubble listener only when the terminal let it pass.
//   Bubbling also lets a document capture listener (useTypeToFocus) take printable
//   keys first. Events already `defaultPrevented` or composing are skipped.
//
// Within a phase the newest registration wins. The first registration whose
// spec for the current platform matches and whose `when()` is not false runs,
// after the registry calls preventDefault() and stopPropagation(). A
// `not-editing` chord `X Y` arms on X (preventDefault) and waits CHORD_TIMEOUT_MS;
// the next key either completes it or cancels it and is consumed (as App's
// chord did before the registry: `g` then an unbound key does nothing).

import { useEffect, useSyncExternalStore } from 'react'
import { currentPlatform, matchesSpec, specSteps, type ShortcutKeys } from './keys'

export type ShortcutScope = 'global' | 'not-editing'

export type ShortcutGroup = 'General' | 'Navigation' | 'Tabs' | 'Files' | 'Safety'

export interface ShortcutDef {
  /** Unique per meaning, e.g. 'stage.close-tab'. */
  id: string
  keys: ShortcutKeys
  scope: ShortcutScope
  /** Shown in the ? sheet. */
  label: string
  group: ShortcutGroup
  run(event: KeyboardEvent): void
  /** Extra condition evaluated at dispatch; false lets the event pass untouched. */
  when?: () => boolean
  /** Hidden from the ? sheet (e.g. one of nine 'focus tab N' entries after the first). */
  hidden?: boolean
}

export const CHORD_TIMEOUT_MS = 1500

interface Entry {
  def: ShortcutDef
}

const entries: Entry[] = []
let snapshot: readonly ShortcutDef[] = []
const subscribers = new Set<() => void>()

function emit(): void {
  snapshot = entries.map((e) => e.def)
  for (const cb of subscribers) cb()
}

/** Register a shortcut; returns its unregister function. */
export function registerShortcut(def: ShortcutDef): () => void {
  const entry: Entry = { def }
  entries.push(entry)
  emit()
  return () => {
    const index = entries.indexOf(entry)
    if (index === -1) return
    entries.splice(index, 1)
    emit()
  }
}

/** Register `def` while mounted; re-registers when its identity changes (memoize it). null registers nothing. */
export function useShortcut(def: ShortcutDef | null): void {
  useEffect(() => (def ? registerShortcut(def) : undefined), [def])
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

function getSnapshot(): readonly ShortcutDef[] {
  return snapshot
}

/** Every registered shortcut, in registration order (for the ? sheet). */
export function useShortcutList(): readonly ShortcutDef[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'])

let pendingChord: { first: string; timer: ReturnType<typeof setTimeout> } | null = null

function clearPendingChord(): void {
  if (pendingChord) clearTimeout(pendingChord.timer)
  pendingChord = null
}

function focusElementOf(event: KeyboardEvent): Element | null {
  return event.target instanceof Element ? event.target : document.activeElement
}

function inTerminal(el: Element | null): boolean {
  return !!el?.closest('.xterm')
}

/** Focus that is not in a text field, a terminal or a code editor. */
export function isNotEditingFocus(el: Element | null): boolean {
  if (!el) return true
  if (el.closest('input, textarea, select, .xterm, .monaco-editor')) return false
  const editable = el.closest('[contenteditable]')
  return !editable || editable.getAttribute('contenteditable') === 'false'
}

function whenAllows(def: ShortcutDef): boolean {
  if (!def.when) return true
  try {
    return def.when() !== false
  } catch {
    return false
  }
}

function runDef(def: ShortcutDef, event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
  def.run(event)
}

/** Try `candidates` newest first; returns true when one ran or armed a chord. */
function dispatch(event: KeyboardEvent, candidates: (def: ShortcutDef) => boolean, allowChords: boolean): boolean {
  const platform = currentPlatform()
  for (let i = entries.length - 1; i >= 0; i--) {
    const def = entries[i].def
    if (!candidates(def)) continue
    const spec = def.keys[platform]
    if (!spec) continue
    const steps = specSteps(spec)
    if (steps.length === 1) {
      if (matchesSpec(event, steps[0]) && whenAllows(def)) {
        runDef(def, event)
        return true
      }
    } else if (steps.length === 2 && allowChords && def.scope === 'not-editing') {
      if (matchesSpec(event, steps[0]) && whenAllows(def)) {
        event.preventDefault()
        clearPendingChord()
        const first = steps[0]
        pendingChord = { first, timer: setTimeout(clearPendingChord, CHORD_TIMEOUT_MS) }
        return true
      }
    }
  }
  return false
}

/** Complete the pending chord; true when one ran. Always clears the pending chord. */
function completeChord(event: KeyboardEvent, focusNotEditing: boolean): boolean {
  const first = pendingChord?.first
  if (!first) return false
  clearPendingChord()
  if (!focusNotEditing) return false
  const platform = currentPlatform()
  for (let i = entries.length - 1; i >= 0; i--) {
    const def = entries[i].def
    if (def.scope !== 'not-editing') continue
    const spec = def.keys[platform]
    if (!spec) continue
    const steps = specSteps(spec)
    if (steps.length !== 2 || steps[0] !== first) continue
    if (matchesSpec(event, steps[1]) && whenAllows(def)) {
      runDef(def, event)
      return true
    }
  }
  return false
}

function onCapture(event: KeyboardEvent): void {
  if (event.isComposing) return
  const focus = focusElementOf(event)
  if (inTerminal(focus)) return
  if (dispatch(event, (def) => def.scope === 'global', false)) clearPendingChord()
}

function onBubble(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return
  if (MODIFIER_KEYS.has(event.key)) return
  const focus = focusElementOf(event)
  const notEditing = isNotEditingFocus(focus)
  const terminal = inTerminal(focus)
  // A pending chord takes the next key: it completes the chord or is consumed by the cancel.
  if (pendingChord) {
    completeChord(event, notEditing)
    return
  }
  dispatch(
    event,
    (def) => (def.scope === 'not-editing' ? notEditing : terminal),
    true,
  )
}

let installed: { target: Window; count: number; generation: number } | null = null
let generation = 0

/**
 * Add the capture and bubble keydown listeners to `target` (default window).
 * Idempotent: a second call adds nothing; the listeners go when every returned
 * uninstall has run.
 */
export function installShortcutListener(target: Window = window): () => void {
  if (!installed) {
    target.addEventListener('keydown', onCapture, true)
    target.addEventListener('keydown', onBubble)
    installed = { target, count: 0, generation: ++generation }
  }
  installed.count += 1
  const mine = installed.generation
  let done = false
  return () => {
    if (done || !installed || installed.generation !== mine) return
    done = true
    installed.count -= 1
    if (installed.count === 0) removeListeners()
  }
}

function removeListeners(): void {
  if (!installed) return
  installed.target.removeEventListener('keydown', onCapture, true)
  installed.target.removeEventListener('keydown', onBubble)
  installed = null
  clearPendingChord()
}

/** Drop every registration, the pending chord and the listeners. Tests only. */
export function resetShortcutsForTests(): void {
  removeListeners()
  entries.length = 0
  clearPendingChord()
  emit()
}
