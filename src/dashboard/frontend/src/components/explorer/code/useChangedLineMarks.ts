// Gutter marks for the lines the scoped conversation changed (PAN-5290 FR-6,
// C-D3, C-D4).
//
// The code pane's scoped conversation comes from the Stage
// (`conversationBeside`); with none there are no marks. The file must be in
// that conversation's changes and map into its repo (an edit workspace is
// another worktree, so it never does). The lines refetch whenever the
// conversation's changes do, and are never applied while the draft is dirty:
// Monaco already moves the existing decorations with the edits.

import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { Conversation } from '../../CommandDeck/ConversationList'
import type { DockScope } from '../../dock/dockScope'
import { useConversationChanges, useScopeChangedPaths } from '../../dock/useConversationChanges'
import { useExplorerStore } from '../explorerStore'
import { fetchChangedLines, toRepoPath } from './changed-lines'
import type { CodeEditorInstance } from './MonacoCodeEditor'

export const CHANGED_LINE_CLASS = 'code-changed-line'

type DecorationsCollection = ReturnType<CodeEditorInstance['createDecorationsCollection']>

const NO_SCOPE: DockScope = { rootId: null, changes: { kind: 'none' }, header: { kind: 'none' }, deckRootId: null, overridden: false }

export interface ChangedLineMarksInput {
  editor: CodeEditorInstance | null
  rootId: string
  path: string
  conversation: Conversation | null
  dirty: boolean
}

export function useChangedLineMarks({ editor, rootId, path, conversation, dirty }: ChangedLineMarksInput): void {
  const scope = useMemo<DockScope>(
    () =>
      conversation
        ? { rootId, changes: { kind: 'conversation', conversation }, header: { kind: 'none' }, deckRootId: null, overridden: false }
        : NO_SCOPE,
    [rootId, conversation],
  )
  const changedPaths = useScopeChangedPaths(scope, { open: conversation !== null })
  const changes = useConversationChanges(conversation, 'conversation', { rootId, enabled: conversation !== null })
  const rootAbs = useExplorerStore((s) => s.roots[rootId]?.dirs['']?.absPath ?? null)
  const name = conversation?.name ?? ''
  const inChanges = conversation !== null && changedPaths.has(path)
  const repoPath = inChanges && changes.data ? toRepoPath(changes.data.repoRoot, rootAbs, path) : null
  const lines = useQuery({
    queryKey: ['conversation-changed-lines', name, repoPath, changes.dataUpdatedAt],
    queryFn: () => fetchChangedLines(name, repoPath ?? ''),
    enabled: inChanges && repoPath !== null,
  })

  // One decorations collection per editor instance, cleared when it unmounts.
  // `identity` is whose marks the collection holds (conversation, root, path).
  const collection = useRef<{ editor: CodeEditorInstance; marks: DecorationsCollection; identity: string } | null>(null)
  useEffect(() => {
    if (!editor) return
    const marks = editor.createDecorationsCollection()
    collection.current = { editor, marks, identity: '' }
    return () => {
      marks.clear()
      if (collection.current?.editor === editor) collection.current = null
    }
  }, [editor])

  const show = inChanges && repoPath !== null
  const data = lines.data
  const identity = `${name}\0${rootId}\0${path}`
  useEffect(() => {
    const current = collection.current?.editor === editor ? collection.current : null
    if (!current) return
    const { marks } = current
    // Another conversation's marks never stay while this one's lines load (or fail to).
    if (current.identity !== identity) {
      marks.clear()
      current.identity = identity
    }
    if (!show) {
      marks.clear()
      return
    }
    if (dirty || !data) return
    marks.set(
      data.lines.map((n) => ({
        range: { startLineNumber: n, startColumn: 1, endLineNumber: n, endColumn: 1 },
        options: { isWholeLine: true, linesDecorationsClassName: CHANGED_LINE_CLASS },
      })),
    )
  }, [editor, identity, show, dirty, data])
}

/** The hook as a renderless component, mounted only while a conversation is beside the pane. */
export function ChangedLineMarks(props: ChangedLineMarksInput): null {
  useChangedLineMarks(props)
  return null
}
