// The explorer's right-click menu: read actions, git actions (PAN-5186,
// WI-B10; FR-5) and write actions (PAN-5190, FR-E1).
//
// Git actions write the index and the working tree, so they never render on a
// `project` root: the primary checkout's index is never written (D-B7). Write
// actions (New file, New folder, Rename, Duplicate, Delete) render in a
// writable tree, which is every tree except under the Changed filter (D-E2).
// On a `project` root they route through an edit workspace (PAN-5191).
// Download links the PAN-5188 route (D-B6).

import { useRef, type ReactNode } from 'react'
import { toast } from 'sonner'

import { useConfirm } from '../../DialogProvider'
import {
  ContextMenuContent,
  ContextMenuDestructiveItem,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../../shared/ContextMenu'
import { explorerDownloadUrl, explorerErrorMessage, gitStage, type ExplorerRootKind, type GitStageAction } from '../explorer-rpc'
import type { Decorations, FileDecoration } from '../git/git-decoration'
import { INLINE_NAME_INPUT_ATTR } from '../actions/InlineNameRow'
import { parentPath } from '../tree/explorer-tree-model'

export interface ExplorerMenuTarget {
  path: string
  kind: 'file' | 'dir' | 'symlink'
  /** Absolute path on the server's disk, when the containing listing is loaded. */
  absPath: string | null
}

export interface ExplorerContextMenuProps {
  rootId: string
  rootKind: ExplorerRootKind
  targets: readonly ExplorerMenuTarget[]
  decorations: Decorations
  onOpen(path: string): void
  onFindInFolder(dirPath: string): void
  onGitChanged(): void
  /** True when write actions apply: the Changed filter is off (PAN-5190). Project roots write through an edit workspace (PAN-5191). */
  writable: boolean
  onNewFile(): void
  onNewFolder(): void
  onRename(path: string): void
  onDuplicate(path: string): void
  onDelete(paths: readonly string[]): void
  children: ReactNode
}

/** Working-tree changes at or under a target (a folder covers its descendants). */
function workingChanges(target: ExplorerMenuTarget, decorations: Decorations): FileDecoration[] {
  const out: FileDecoration[] = []
  const prefix = target.path === '' ? '' : `${target.path}/`
  for (const [path, decoration] of decorations.files) {
    if (decoration.committedOnly) continue
    if (path === target.path || (target.kind === 'dir' && path.startsWith(prefix))) out.push(decoration)
  }
  return out
}

function downloadViaAnchor(url: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function copyText(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(done)
  } catch (e) {
    toast.error(`Couldn't copy: ${explorerErrorMessage(e)}`)
  }
}

export function ExplorerContextMenu({
  rootId,
  rootKind,
  targets,
  decorations,
  onOpen,
  onFindInFolder,
  onGitChanged,
  writable,
  onNewFile,
  onNewFolder,
  onRename,
  onDuplicate,
  onDelete,
  children,
}: ExplorerContextMenuProps) {
  const confirm = useConfirm()
  // An item that opens an inline name input renders it while the menu's focus
  // trap is still active, so the input's own focus does not stick, and Radix
  // would then return focus to the trigger (the tree). Once the menu content
  // has unmounted, focus the input instead.
  const startsInlineEditRef = useRef(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  const startInlineEdit = (start: () => void) => () => {
    startsInlineEditRef.current = true
    start()
  }
  const single = targets.length === 1 ? targets[0] : null
  const paths = targets.map((t) => t.path)
  const changes = targets.flatMap((t) => workingChanges(t, decorations))
  // `staged` is the index column only: a staged file can still have unstaged
  // edits, which the contract cannot express. So Stage stays enabled for any
  // working-tree change; `git add` on a fully staged file changes nothing.
  const canStage = changes.length > 0
  const canUnstage = changes.some((c) => c.staged)
  const canDiscard = changes.length > 0

  const runGit = async (action: GitStageAction) => {
    try {
      await gitStage(rootId, paths, action)
      onGitChanged()
    } catch (e) {
      toast.error(explorerErrorMessage(e))
    }
  }

  const discard = async () => {
    const ok = await confirm({
      title: 'Discard changes?',
      message: paths.join('\n'),
      confirmLabel: 'Discard',
      variant: 'destructive',
    })
    if (ok) await runGit('discard')
  }

  const findInFolderPath = single ? (single.kind === 'dir' ? single.path : parentPath(single.path)) : ''

  return (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild ref={triggerRef}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(event) => {
          if (!startsInlineEditRef.current) return
          event.preventDefault()
          startsInlineEditRef.current = false
          triggerRef.current?.querySelector<HTMLInputElement>(`[${INLINE_NAME_INPUT_ATTR}]`)?.focus()
        }}
      >
        {single && single.kind !== 'dir' && <ContextMenuItem onSelect={() => onOpen(single.path)}>Open</ContextMenuItem>}
        {targets.length > 0 && (
          <>
            <ContextMenuItem
              disabled={targets.some((t) => t.absPath === null)}
              onSelect={() => void copyText(targets.map((t) => t.absPath ?? t.path).join('\n'), 'Copied path')}
            >
              Copy path
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void copyText(paths.join('\n'), 'Copied relative path')}>
              Copy relative path
            </ContextMenuItem>
          </>
        )}
        {targets.length <= 1 && (
          <ContextMenuItem onSelect={() => onFindInFolder(findInFolderPath)}>Find in folder</ContextMenuItem>
        )}
        {single && (
          <ContextMenuItem onSelect={() => downloadViaAnchor(explorerDownloadUrl(rootId, single.path))}>Download</ContextMenuItem>
        )}
        {rootKind !== 'project' && targets.length > 0 && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!canStage} onSelect={() => void runGit('stage')}>
              Stage
            </ContextMenuItem>
            <ContextMenuItem disabled={!canUnstage} onSelect={() => void runGit('unstage')}>
              Unstage
            </ContextMenuItem>
            <ContextMenuDestructiveItem disabled={!canDiscard} onSelect={() => void discard()}>
              Discard changes
            </ContextMenuDestructiveItem>
          </>
        )}
        {writable && (
          <>
            <ContextMenuSeparator />
            {targets.length <= 1 && (
              <>
                <ContextMenuItem onSelect={startInlineEdit(onNewFile)}>New file</ContextMenuItem>
                <ContextMenuItem onSelect={startInlineEdit(onNewFolder)}>New folder</ContextMenuItem>
              </>
            )}
            {single && (
              <>
                <ContextMenuItem onSelect={startInlineEdit(() => onRename(single.path))}>Rename</ContextMenuItem>
                <ContextMenuItem onSelect={() => onDuplicate(single.path)}>Duplicate</ContextMenuItem>
              </>
            )}
            {targets.length > 0 && <ContextMenuDestructiveItem onSelect={() => onDelete(paths)}>Delete</ContextMenuDestructiveItem>}
          </>
        )}
      </ContextMenuContent>
    </ContextMenuRoot>
  )
}
