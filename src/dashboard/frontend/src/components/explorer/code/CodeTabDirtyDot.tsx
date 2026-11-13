/** The unsaved-changes dot on a code pane's tab (PAN-5187, FR-7). */
import { selectIsDirty, useCodeDrafts } from './code-drafts'

export function CodeTabDirtyDot({ rootId, path }: { rootId?: string; path?: string }) {
  const dirty = useCodeDrafts(selectIsDirty(rootId, path))
  if (!dirty) return null
  return (
    <span aria-label="Unsaved changes" className="text-muted-foreground">
      ●
    </span>
  )
}
