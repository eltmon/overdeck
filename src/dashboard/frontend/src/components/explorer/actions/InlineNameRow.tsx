/**
 * The inline name input for New file, New folder and Rename (PAN-5190,
 * FR-E2, FR-E3, D-E11, D-E18).
 *
 * Enter commits a valid name and Escape cancels. Blur commits a valid name
 * that differs from the initial value, and otherwise cancels. A settled guard
 * keeps a blur that follows Enter or Escape from acting a second time. Every
 * keydown stops here, so typing never moves the tree's focus or opens a file.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { File, Folder } from 'lucide-react'

import { INDENT_PX, ROW_HEIGHT } from '../tree/ExplorerRow'
import { validateEntryName } from './name-rules'

/** Marks the input, so the context menu can focus it once the menu has closed. */
export const INLINE_NAME_INPUT_ATTR = 'data-explorer-inline-name'

export interface InlineNameRowProps {
  depth: number
  kind: 'file' | 'dir'
  initialValue: string
  /** Names of the loaded entries in the target folder. */
  siblings: readonly string[]
  /** The name being renamed; keeping it is valid. */
  current?: string
  /** Resolves to an error message (the row stays open) or null (the row closes). */
  onCommit(name: string): Promise<string | null>
  onCancel(): void
}

/** The selection a rename starts with: the stem of a file, the whole name otherwise. */
function initialSelection(value: string, kind: 'file' | 'dir'): [number, number] {
  const dot = value.lastIndexOf('.')
  return kind === 'file' && dot > 0 ? [0, dot] : [0, value.length]
}

export function InlineNameRow({ depth, kind, initialValue, siblings, current, onCommit, onCancel }: InlineNameRowProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const settledRef = useRef(false)
  const [value, setValue] = useState(initialValue)
  const [touched, setTouched] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [refocus, setRefocus] = useState(0)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    if (initialValue) input.setSelectionRange(...initialSelection(initialValue, kind))
    // Mount only: re-applying the initial selection while typing would fight the caret.
  }, [])

  useEffect(() => {
    if (refocus > 0) inputRef.current?.focus()
  }, [refocus])

  const validation = validateEntryName(value, siblings, current)
  const error = serverError ?? (touched && 'error' in validation ? validation.error : null)

  const commit = async (name: string): Promise<void> => {
    settledRef.current = true
    setPending(true)
    const message = await onCommit(name)
    if (message === null) return
    setServerError(message)
    setPending(false)
    settledRef.current = false
    setRefocus((n) => n + 1)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      if (settledRef.current) return
      settledRef.current = true
      onCancel()
      return
    }
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (settledRef.current) return
    if ('error' in validation) {
      setTouched(true)
      return
    }
    void commit(validation.name)
  }

  const handleBlur = () => {
    if (settledRef.current) return
    if ('name' in validation && validation.name !== initialValue) {
      void commit(validation.name)
      return
    }
    settledRef.current = true
    onCancel()
  }

  const Icon = kind === 'dir' ? Folder : File

  return (
    <div
      role="none"
      className="relative flex items-center gap-1.5 pr-2 text-xs"
      style={{ height: ROW_HEIGHT, paddingLeft: 6 + depth * INDENT_PX }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        {...{ [INLINE_NAME_INPUT_ATTR]: '' }}
        value={value}
        disabled={pending}
        aria-label={current === undefined ? (kind === 'dir' ? 'New folder name' : 'New file name') : `Rename ${current}`}
        aria-invalid={error !== null}
        spellCheck={false}
        autoComplete="off"
        className="h-[18px] min-w-0 flex-1 border border-ring bg-background px-1 text-xs text-foreground outline-none disabled:opacity-60"
        onChange={(event) => {
          setValue(event.target.value)
          setTouched(true)
          setServerError(null)
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onContextMenu={(event) => event.stopPropagation()}
      />
      {error !== null && (
        <div
          role="alert"
          className="absolute left-0 top-full z-10 border border-border bg-popover px-1.5 py-0.5 text-[11px] text-destructive"
          style={{ marginLeft: 6 + depth * INDENT_PX }}
        >
          {error}
        </div>
      )}
    </div>
  )
}
