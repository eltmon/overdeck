import { useState, type ReactNode, type KeyboardEvent } from 'react'
import { Bot, Terminal, Globe } from 'lucide-react'
import { orderIntents } from './launcherOrdering'
import styles from '../stage.module.css'

export type LauncherIntentKind = 'agent' | 'terminal' | 'web'

export interface LauncherIntent {
  /** Stable id — 'claude-code' | 'terminal' | 'web' | 'codex' | an agent id. */
  id: string
  kind: LauncherIntentKind
  /** Agent display name for kind 'agent' (e.g. "Claude Code", "Codex"). */
  agentName?: string
  /** Keyboard hint shown on the row, e.g. "⌘↵". */
  keys?: string
}

/** Default intent set + order. The `launcher-ordering` bead refines ordering;
 * the `launcher-wiring` bead maps selection to actions. */
export const DEFAULT_INTENTS: LauncherIntent[] = [
  { id: 'claude-code', kind: 'agent', agentName: 'Claude Code', keys: '⌘↵' },
  { id: 'terminal', kind: 'terminal', keys: '⌃↵' },
  { id: 'web', kind: 'web', keys: '⌥↵' },
  { id: 'codex', kind: 'agent', agentName: 'Codex', keys: '⌘⇧↵' },
]

/** Row label per the PRD rules: terminal→"Run in terminal:", web→"Search the
 * web:", agent→"Ask {agentName}:". */
export function intentLabel(intent: LauncherIntent): string {
  switch (intent.kind) {
    case 'terminal':
      return 'Run in terminal:'
    case 'web':
      return 'Search the web:'
    case 'agent':
      return `Ask ${intent.agentName ?? 'agent'}:`
  }
}

function IntentIcon({ kind }: { kind: LauncherIntentKind }) {
  const Icon = kind === 'terminal' ? Terminal : kind === 'web' ? Globe : Bot
  return <Icon size={14} />
}

export interface LauncherProps {
  intents?: LauncherIntent[]
  /** Fired when a row is chosen (click or Enter) with the typed query. */
  onSelect?: (intent: LauncherIntent, query: string) => void
  /** Compact/suppressed mode renders only the quick-action rows (no extras). */
  compact?: boolean
  /** History / file-completion content shown below the rows; hidden in compact. */
  extras?: ReactNode
  placeholder?: string
  /** Id of the last-run agent in this workspace; floats it to position 1. */
  lastUsedAgentId?: string | null
}

/**
 * Launcher — the HomePane omnibox (PAN-1549). A text input plus a quick-action
 * dropdown (one row per intent, first row auto-selected). The dropdown is
 * hidden while the input is empty; rows use onMouseDown+preventDefault so a
 * click fires the action without blurring the input first.
 */
export function Launcher({
  intents = DEFAULT_INTENTS,
  onSelect,
  compact = false,
  extras,
  placeholder = 'Ask, run, or search…',
  lastUsedAgentId,
}: LauncherProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const open = query.length > 0
  const ordered = orderIntents({ intents, query, lastUsedAgentId })

  const choose = (index: number) => {
    const intent = ordered[index]
    if (intent) onSelect?.(intent, query)
  }

  const chooseIntent = (intent: LauncherIntent | undefined) => {
    if (intent) onSelect?.(intent, query)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, ordered.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
      return
    }
    if (e.key !== 'Enter') return

    // Keyboard accelerators (PRD keymap). Modifier+Enter targets a specific
    // intent regardless of the highlighted row; plain Enter runs the selection.
    if (e.metaKey && e.shiftKey) {
      e.preventDefault()
      chooseIntent(ordered.find((i) => i.id === 'codex')) // ⌘⇧↵ → Codex
    } else if (e.metaKey) {
      e.preventDefault()
      chooseIntent(ordered[0]) // ⌘↵ → top intent ("repeat last")
    } else if (e.ctrlKey) {
      e.preventDefault()
      chooseIntent(ordered.find((i) => i.kind === 'terminal')) // ⌃↵ → terminal
    } else if (e.altKey) {
      e.preventDefault()
      chooseIntent(ordered.find((i) => i.kind === 'web')) // ⌥↵ → web
    } else {
      choose(selected)
    }
  }

  return (
    <div className={styles.launcher}>
      <div className={styles.launchBar}>
        <input
          className={styles.launchInput}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && (
        <div className={styles.dropdown} role="listbox" aria-label="Quick actions">
          {ordered.map((intent, index) => (
            <div
              key={intent.id}
              role="option"
              aria-selected={index === selected}
              className={`${styles.ddRow} ${index === selected ? styles.ddRowSel : ''}`}
              onMouseEnter={() => setSelected(index)}
              onMouseDown={(e) => {
                e.preventDefault() // keep input focus
                choose(index)
              }}
            >
              <span className={styles.gicon}>
                <IntentIcon kind={intent.kind} />
              </span>
              <span className={styles.ddLab}>
                <b>{intentLabel(intent)}</b> {query}
              </span>
              {intent.keys && <span className={styles.ddKeys}>{intent.keys}</span>}
            </div>
          ))}
          {!compact && extras}
        </div>
      )}
    </div>
  )
}
