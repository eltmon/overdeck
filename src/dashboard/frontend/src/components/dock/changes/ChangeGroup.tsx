// A collapsible group of changed files in the Changes tab (PAN-5289 §6.4):
// "Not committed yet", one commit, or "Committed on <branch>".

import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export interface ChangeGroupProps {
  /** The header row content after the chevron. */
  header: ReactNode
  defaultOpen?: boolean
  /** Called the first time the group opens (lazy file lists). */
  onOpen?(): void
  children: ReactNode
  /** Accessible name of the group. */
  label: string
}

export function ChangeGroup({ header, defaultOpen = true, onOpen, children, label }: ChangeGroupProps) {
  const [open, setOpen] = useState(defaultOpen)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div role="group" aria-label={label} className="border-t border-border first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen?.()
          setOpen(!open)
        }}
        className="flex w-full items-center gap-2 px-3 py-[7px] text-left text-[12.5px] hover:bg-accent"
      >
        <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {header}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  )
}

/** A neutral tag in a group header (pushed, not pushed, this chat, merged). */
export function ChangeTag({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded border border-border px-1.5 font-mono text-[11px] leading-[18px] text-muted-foreground">{children}</span>
}

/** Commit time: hour:minute today, otherwise the date. */
export function commitTime(iso: string, now = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString()
}
