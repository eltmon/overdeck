// Live tab of the work dock (PAN-5289 §6.12, B-D9; PAN-5284 D-17).
//
// The tab renders the conversation-dock panels. It is shown only when there
// is something to watch. `useConvoDock.add` still sets `expanded: true` when
// an item is popped into the dock; while a dock is mounted that flag means
// "show me Live": the hook opens this deck's dock on Live and resets it. With
// no items the flag is only reset.

import { useEffect } from 'react'

import { useConvoDock } from '../../lib/convoDock'
import { ConversationDock, useLiveDockItems } from './ConversationDock'
import { useWorkDockStore } from './workDockStore'

export interface LiveTabProps {
  deckKey: string
}

export function LiveTab(_props: LiveTabProps) {
  return <ConversationDock />
}

export interface LiveTabState {
  /** The Live tab is rendered only when there is something to watch. */
  visible: boolean
  count: number
  /** A watched conversation waits on the operator. */
  needsYou: boolean
}

export function useLiveTab(deckKey: string): LiveTabState {
  const { items, needsYouIds } = useLiveDockItems()
  const { expanded, setExpanded } = useConvoDock()
  const count = items.length

  useEffect(() => {
    if (!expanded) return
    if (count > 0) useWorkDockStore.getState().openDock(deckKey, { tab: 'live' })
    setExpanded(false)
  }, [expanded, count, deckKey, setExpanded])

  return { visible: count > 0, count, needsYou: needsYouIds.size > 0 }
}
