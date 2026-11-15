// Live tab of the work dock (PAN-5289 §6.12, B-D9). A stub until the conversation dock moves in.

export interface LiveTabProps {
  deckKey: string
}

export function LiveTab(_props: LiveTabProps) {
  return <p className="px-3 py-4 text-xs text-muted-foreground">Conversations you are watching show here.</p>
}

export interface LiveTabState {
  /** The Live tab is rendered only when there is something to watch. */
  visible: boolean
  count: number
  /** A watched conversation waits on the operator. */
  needsYou: boolean
}

const HIDDEN: LiveTabState = { visible: false, count: 0, needsYou: false }

export function useLiveTab(_deckKey: string): LiveTabState {
  return HIDDEN
}
