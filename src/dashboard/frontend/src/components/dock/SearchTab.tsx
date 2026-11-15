// Search tab of the work dock (PAN-5289 WI-14). A stub until content search moves in.

import type { DockScope } from './dockScope'

export interface SearchTabProps {
  deckKey: string
  scope: DockScope
}

export function SearchTab(_props: SearchTabProps) {
  return <p className="px-3 py-4 text-xs text-muted-foreground">Search the contents of this root's files here.</p>
}
