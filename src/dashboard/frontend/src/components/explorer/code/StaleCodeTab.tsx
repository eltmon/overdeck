/**
 * A code tab whose root no longer resolves (PAN-5290 FR-13, C-D13): the
 * server answered ROOT_NOT_FOUND to the file read, or to the editor bar's
 * status or changes query (C-D13b). Instead of "Couldn't open file" it says
 * what happened by root kind and offers Open on main, which retargets the
 * tab to the deck's registered project, and Close tab.
 */
import { usePanesStore } from '../../../lib/panesStore'
import { findRegisteredProject } from '../../CommandDeck/UnknownProjectState'
import styles from '../../Stage/stage.module.css'
import { BUTTON } from '../edit/EditorBar'
import { ExplorerHttpError } from '../explorer-http'
import { explorerErrorCode, parseRootId } from '../explorer-rpc'
import { useRootContext } from '../rootForConversation'

/** ROOT_NOT_FOUND from the explorer RPC (PanRpcError) or an edit-workspace HTTP call. */
export function isRootNotFound(error: unknown): boolean {
  return explorerErrorCode(error) === 'ROOT_NOT_FOUND' || (error instanceof ExplorerHttpError && error.code === 'ROOT_NOT_FOUND')
}

export const NO_PROJECT_TITLE = 'This deck has no registered project'

function staleSentence(rootId: string): string {
  const kind = parseRootId(rootId)?.kind
  if (kind === 'workspace') return 'This edit workspace was merged or discarded.'
  if (kind === 'issue') return "This issue's workspace no longer exists."
  if (kind === 'project') return 'This project is no longer registered on this machine.'
  return "This tab's files no longer exist."
}

export interface StaleCodeTabProps {
  rootId: string
  path: string
  deckKey: string
  paneId: string
}

export function StaleCodeTab({ rootId, path, deckKey, paneId }: StaleCodeTabProps) {
  const { projects } = useRootContext()
  const project = findRegisteredProject(projects, deckKey)
  const kind = parseRootId(rootId)?.kind
  const offerMain = kind === 'workspace' || kind === 'issue'
  return (
    <div className={styles.placeholder} data-testid="code-pane-stale">
      <div className={styles.placeholderTitle}>{staleSentence(rootId)}</div>
      <div className={styles.placeholderHint}>
        <span className="font-mono">{path}</span>
      </div>
      <div className="mt-3 flex items-center justify-center gap-2">
        {offerMain ? (
          <button
            type="button"
            className={BUTTON}
            disabled={!project}
            title={project ? undefined : NO_PROJECT_TITLE}
            onClick={() => {
              if (project) usePanesStore.getState().updatePane(deckKey, paneId, { explorerRootId: `project:${project.key}` })
            }}
          >
            Open on main
          </button>
        ) : null}
        <button type="button" className={BUTTON} onClick={() => usePanesStore.getState().closePane(deckKey, paneId)}>
          Close tab
        </button>
      </div>
    </div>
  )
}
