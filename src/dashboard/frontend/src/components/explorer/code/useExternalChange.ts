/**
 * External changes for one code pane (PAN-5187, FR-8).
 *
 * Wires the external-change controller (external-change.ts) to the pane's
 * file: watch events come from PAN-5186's watch hub (one server
 * subscription per root), re-reads go through explorerReadFile, and the
 * draft, the save queue and the self-write registry answer the controller's
 * questions. A `resync` signal (overflow or a reconnect) re-reads, since
 * events may have been lost (D-C21). A clean pane reloads; the state the
 * banner shows is returned.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { explorerErrorCode, readFile } from '../explorer-rpc'
import { subscribeExplorerWatch } from '../watch/explorer-watch-hub'
import { draftKey, isDraftDirty, useCodeDrafts } from './code-drafts'
import { createExternalChangeController, type DiskRead, type ExternalChangeController, type ExternalChangeState } from './external-change'
import { isRecentSelfWrite } from './self-write-registry'
import { codeSaveQueue } from './useCodePaneSave'

const CLEAN: ExternalChangeState = { kind: 'clean' }

/** The file as the controller sees it: missing, or its text and signature. */
export async function readDisk(rootId: string, path: string): Promise<DiskRead> {
  try {
    const result = await readFile(rootId, path)
    if (result.kind !== 'text') throw new Error(`${path} is no longer a text file`)
    return { missing: false, text: result.text ?? '', signature: result.signature }
  } catch (error) {
    if (explorerErrorCode(error) === 'NOT_FOUND') return { missing: true }
    throw error
  }
}

export function useExternalChange(rootId: string, path: string): {
  state: ExternalChangeState
  setState(state: ExternalChangeState): void
} {
  const key = draftKey(rootId, path)
  const [state, setReactState] = useState<ExternalChangeState>(CLEAN)
  const controller = useRef<ExternalChangeController | null>(null)

  useEffect(() => {
    const drafts = () => useCodeDrafts.getState()
    const instance = createExternalChangeController({
      getPath: () => path,
      getBaseSignature: () => drafts().drafts[key]?.baseSignature ?? null,
      isDirty: () => isDraftDirty(drafts().drafts[key]),
      isSaveInFlight: () => codeSaveQueue.isInFlight(key),
      whenSaveIdle: () => codeSaveQueue.whenIdle(key),
      reread: () => readDisk(rootId, path),
      isSelfWrite: (signature) => isRecentSelfWrite(key, signature),
      reload: (read) => drafts().reset(key, read.text, read.signature),
      setState: setReactState,
    })
    controller.current = instance
    const unsubscribe = subscribeExplorerWatch(rootId, (signal) => {
      if (signal.kind === 'events') instance.handle(signal.events)
      else instance.handle([{ kind: 'overflow', path: '' }])
    })
    return () => {
      unsubscribe()
      instance.dispose()
      if (controller.current === instance) controller.current = null
    }
  }, [rootId, path, key])

  const setState = useCallback((next: ExternalChangeState) => {
    controller.current?.noteState(next)
    setReactState(next)
  }, [])

  return { state, setState }
}
