// Act on an open-path UI command (PAN-5349 O-D6): show the project's deck,
// then open a file in a code pane or reveal a folder in the Files dock.
// Uses only exported helpers; never edits the Stage.

import { toast } from 'sonner'
import { uiOpenSummary, type UiOpenResolution } from '@overdeck/contracts'
import { openCodePane } from '../../components/explorer/openCodePane'
import { useActiveDock } from '../../components/dock/activeDock'
import { useWorkDockStore } from '../../components/dock/workDockStore'
import type { DeckNavigation } from '../../components/frame/deck/deckNavigation'
import { selectActivePaneId, usePanesStore } from '../panesStore'

export function openPathInDeck(resolution: UiOpenResolution, navigation: Pick<DeckNavigation, 'openInDeck'>): void {
  // Decks are keyed by project name; rootId keeps the registered key (PAN-5398).
  const { deckKey, rootId, relPath, kind, line, column } = resolution
  usePanesStore.getState().ensureHome(deckKey)
  navigation.openInDeck({ projectKey: deckKey })

  const dock = useWorkDockStore.getState()
  if (kind === 'file') {
    // The active code pane sets the dock scope, so a file needs no override.
    openCodePane(deckKey, { rootId, path: relPath, line, column })
    dock.openDock(deckKey, { tab: 'files', reveal: { rootId, path: relPath } })
  } else {
    const current = useActiveDock.getState().current
    if (current?.deckKey !== deckKey || current.rootId !== rootId) {
      const anchor =
        current?.deckKey === deckKey ? current.activePaneId : selectActivePaneId(deckKey)(usePanesStore.getState())
      dock.setRootOverride(deckKey, rootId, anchor ?? undefined)
    }
    dock.openDock(deckKey, { tab: 'files', reveal: relPath === '' ? undefined : { rootId, path: relPath } })
  }
  toast(uiOpenSummary(resolution))
}
