// The `/open?path=…[&line=n&column=n]` link (PAN-5349 O-D7, O-D9).
//
// `pan open` opens this URL when no dashboard tab is listening (or with
// `--new-tab`). On mount at `/open`, the host asks the server to resolve the
// path with `dryRun: true` (so other tabs do not act too), opens it in this
// tab's deck, and moves the URL to the project's deck. A path outside every
// project offers to add its folder as a project.

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { UiOpenResolution } from '@overdeck/contracts'
import { fetchWithTimeout } from '../../lib/apiFetch'
import { openPathInDeck } from '../../lib/uiCommands/openPathInDeck'
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport'
import { useDeckNavigation } from '../frame/deck/deckNavigation'
import { buttonClass } from '../project/new/ProjectCreateForm'
import { useAddProjectDialog } from '../project/new/addProjectDialogStore'
import { Modal } from '../shared/Modal'

export const OPEN_PATHNAME = '/open'

interface OpenRequest {
  path: string
  line?: number
  column?: number
}

function positiveInt(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/** The folder to offer as a project: the folder itself, or a file's parent. */
function folderOf(path: string, kind: unknown): string {
  if (kind === 'dir') return path
  const cut = path.replace(/\/+$/, '').lastIndexOf('/')
  return cut > 0 ? path.slice(0, cut) : '/'
}

export function OpenPathHost() {
  const navigation = useDeckNavigation()
  const navigationRef = useRef(navigation)
  navigationRef.current = navigation
  const started = useRef(false)
  const [outsideDir, setOutsideDir] = useState<string | null>(null)

  useEffect(() => {
    if (started.current || window.location.pathname !== OPEN_PATHNAME) return
    started.current = true
    const params = new URLSearchParams(window.location.search)
    const path = params.get('path')
    if (!path) {
      toast.error('Nothing to open: the link has no path')
      window.history.replaceState(null, '', '/')
      return
    }
    const request: OpenRequest = { path, line: positiveInt(params.get('line')), column: positiveInt(params.get('column')) }
    void (async () => {
      try {
        const response = await fetchWithTimeout('/api/ui/open', {
          method: 'POST',
          credentials: 'include',
          headers: await dashboardMutationJsonHeaders(),
          body: JSON.stringify({ ...request, dryRun: true }),
        })
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
        if (response.ok) {
          const resolution = body as unknown as UiOpenResolution
          openPathInDeck(resolution, navigationRef.current)
          if (window.location.pathname === OPEN_PATHNAME) {
            window.history.replaceState(null, '', `/command-deck/${encodeURIComponent(resolution.deckKey)}`)
          }
          return
        }
        if (body['error'] === 'outside-projects') {
          setOutsideDir(folderOf(path, body['kind']))
        } else if (body['error'] === 'no-root') {
          toast.error(`${path} is inside ${String(body['projectKey'])} but not in a feature or scratch workspace`)
        } else if (body['error'] === 'not-found') {
          toast.error(`${path} doesn't exist`)
        } else {
          toast.error(`Couldn't open ${path}`)
        }
      } catch {
        toast.error(`Couldn't open ${path}`)
      }
    })()
  }, [])

  if (outsideDir === null) return null
  const close = () => setOutsideDir(null)
  return (
    <Modal
      title="Add it as a project?"
      onClose={close}
      footer={
        <>
          <button type="button" className={buttonClass} onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              close()
              useAddProjectDialog.getState().show('existing', undefined, { initialPath: outsideDir })
            }}
          >
            Add project
          </button>
        </>
      }
    >
      <p className="text-sm text-foreground">
        <span className="font-mono">{outsideDir}</span> isn&apos;t in a project. Add it as a project?
      </p>
    </Modal>
  )
}
