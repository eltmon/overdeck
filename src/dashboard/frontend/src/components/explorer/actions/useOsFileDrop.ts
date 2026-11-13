/**
 * Upload files dropped from the OS onto the explorer tree (PAN-5190, FR-E8,
 * D-E16).
 *
 * The drop handler snapshots the dropped items synchronously, because a
 * DataTransfer's items are unreadable once the handler returns. A folder is
 * recognized by `webkitGetAsEntry().isDirectory` and skipped; nothing walks
 * its contents. Files over 100 MiB are skipped before sending. Each file
 * uploads through `runWrite`, one at a time; an existing name is refused, never
 * overwritten. The successful uploads form one undo op.
 */

import { toast } from 'sonner'

import { ExplorerHttpError, uploadExplorerFile } from '../explorer-http'
import { explorerErrorMessage } from '../explorer-rpc'
import { baseName } from '../tree/explorer-tree-model'
import type { ExplorerActions } from './useExplorerActions'

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

export interface DroppedItem {
  name: string
  file: File | null
  isDirectory: boolean
}

/** Read synchronously inside the drop handler (D-E16). */
export function snapshotDroppedItems(dt: DataTransfer): DroppedItem[] {
  const items = Array.from(dt.items ?? []).filter((item) => item.kind === 'file')
  if (items.length === 0) return Array.from(dt.files ?? []).map((file) => ({ name: file.name, file, isDirectory: false }))
  return items.map((item) => {
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
    const file = item.getAsFile()
    return { name: entry?.name ?? file?.name ?? '', file, isDirectory: entry?.isDirectory === true }
  })
}

export async function uploadDroppedItems(
  items: readonly DroppedItem[],
  destDir: string,
  actions: Pick<ExplorerActions, 'runWrite' | 'recordCreated'>,
  deps: { upload?: typeof uploadExplorerFile } = {},
): Promise<{ uploaded: string[] }> {
  const upload = deps.upload ?? uploadExplorerFile
  const folders = items.filter((item) => item.isDirectory).map((item) => item.name)
  if (folders.length > 0) toast.error(`Drop files, not folders: ${folders.join(', ')}`)

  const files: File[] = []
  for (const item of items) {
    if (item.isDirectory || !item.file) continue
    if (item.file.size > MAX_UPLOAD_BYTES) toast.error(`${item.name} is larger than 100 MiB.`)
    else files.push(item.file)
  }
  if (files.length === 0) return { uploaded: [] }

  const uploaded: string[] = []
  const loading = toast.loading(files.length === 1 ? `Uploading ${files[0].name}…` : `Uploading ${files.length} files…`)
  try {
    for (const file of files) {
      try {
        const result = await actions.runWrite((rootId) => upload(rootId, destDir, file))
        uploaded.push(result.path)
      } catch (error) {
        if (error instanceof ExplorerHttpError && error.code === 'ALREADY_EXISTS') {
          toast.error(`${file.name} already exists in ${destDir || 'the root'}`)
        } else {
          toast.error(`Couldn't upload ${file.name}: ${explorerErrorMessage(error)}`)
        }
      }
    }
  } finally {
    toast.dismiss(loading)
  }

  if (uploaded.length > 0) {
    const one = uploaded.length === 1 ? baseName(uploaded[0]) : null
    actions.recordCreated(uploaded, one ? `upload of ${one}` : `upload of ${uploaded.length} files`)
    toast(one ? `Uploaded ${one}` : `Uploaded ${uploaded.length} files`)
  }
  return { uploaded }
}
