// Files tab of the work dock (PAN-5289 §6.8). A stub until the explorer moves in.

import type { DockScope } from './dockScope'

export interface FilesTabProps {
  deckKey: string
  scope: DockScope
}

export function FilesTab(_props: FilesTabProps) {
  return <p className="px-3 py-4 text-xs text-muted-foreground">The file tree for this root shows here.</p>
}
