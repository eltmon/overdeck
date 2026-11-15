// Changes tab of the work dock (PAN-5289 §6.4). A stub until the change lists land.

import type { DockScope } from './dockScope'

export interface ChangesTabProps {
  deckKey: string
  scope: DockScope
}

export function ChangesTab(_props: ChangesTabProps) {
  return <p className="px-3 py-4 text-xs text-muted-foreground">The files changed in this scope show here.</p>
}

/** The count shown on the Changes tab label, or null while unknown. */
export function useChangesCount(_scope: DockScope): number | null {
  return null
}
