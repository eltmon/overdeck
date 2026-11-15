// Files scope for the Ctrl K palette (PAN-5289 §6.13, B-D5, NFR-6).
//
// The palette is mounted outside every Stage deck, so it finds files through
// the mounted work dock's registration (activeDock): its root, the files the
// scoped conversation changed, and its openFile. With no mounted dock or an
// empty query it lists nothing. Answers to stale queries are dropped. This
// module must not import CommandPalette.tsx.

import { useEffect, useMemo, useRef, useState, type ElementType } from 'react'
import { FileText } from 'lucide-react'

import { useActiveDock } from '../dock/activeDock'
import { searchFiles } from '../explorer/explorer-rpc'
import { rankFileMatches } from '../explorer/search/fileMatch'
import { baseName, parentPath } from '../explorer/tree/explorer-tree-model'

const REQUEST_LIMIT = 200
const SHOW = 20

export interface FilePaletteAction {
  id: string
  label: string
  description?: string
  icon: ElementType
  group: 'Files'
  meta?: Array<{ text: string; pill?: boolean }>
  rank: number
  onSelect(): void
}

export function useFileProviderActions(isOpen: boolean, query: string): FilePaletteAction[] {
  const current = useActiveDock((s) => s.current)
  const rootId = current?.rootId ?? null
  const [answer, setAnswer] = useState<{ rootId: string; query: string; paths: string[] } | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const q = query.trim()
    const mySeq = ++seq.current
    if (!isOpen || !q || !rootId) {
      setAnswer(null)
      return
    }
    // Started inside a promise, so a missing transport becomes a handled rejection.
    Promise.resolve()
      .then(() => searchFiles(rootId, q, REQUEST_LIMIT))
      .then(
        (result) => {
          if (mySeq === seq.current) setAnswer({ rootId, query: q, paths: [...result.paths] })
        },
        () => {
          if (mySeq === seq.current) setAnswer(null)
        },
      )
  }, [isOpen, query, rootId])

  return useMemo(() => {
    if (!isOpen || !current || !answer || answer.rootId !== current.rootId) return []
    const changed = current.changedPaths
    return rankFileMatches(answer.paths, answer.query, changed)
      .slice(0, SHOW)
      .map((path, index) => ({
        id: `file-${path}`,
        label: baseName(path),
        description: parentPath(path) || undefined,
        icon: FileText,
        group: 'Files' as const,
        meta: changed.has(path) ? [{ text: 'changed here', pill: true }] : undefined,
        rank: index,
        onSelect: () => current.openFile(path),
      }))
  }, [isOpen, current, answer])
}
