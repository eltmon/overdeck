import { useCallback, useRef, useState, type RefObject } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Inline-rename controls for a project title. Everything a header needs to
 * render the pencil, the draft input, and the error surface, so the header
 * itself stays presentational (PAN-3156 moved this out of ProjectOverview's
 * hero billboard and onto the `# <project>` title).
 */
export interface ProjectRenameControls {
  /** True while the draft input replaces the title. */
  editing: boolean
  /** Current draft value of the input. */
  draftName: string
  /** Server-side rename failure (e.g. a name conflict); keeps the editor open. */
  error: string | null
  /** True while the rename request is in flight; disables the input. */
  pending: boolean
  /** Focus/select target for the draft input. */
  inputRef: RefObject<HTMLInputElement>
  /** Enter edit mode with the current name pre-filled and selected. */
  begin: () => void
  /** Update the draft value. */
  change: (value: string) => void
  /** Send the rename (Enter or blur). */
  commit: () => void
  /** Abandon the draft without sending a request (Escape). */
  cancel: () => void
}

/**
 * useProjectRename — owns the `POST /api/projects/:id/rename` mutation and the
 * inline-edit state for a project title. The project is addressed by its
 * projects.yaml key when known, falling back to the display name.
 */
export function useProjectRename(projectName: string, projectKey?: string): ProjectRenameControls {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const draftNameRef = useRef('')
  const committingRef = useRef(false)

  const renameMutation = useMutation({
    mutationFn: async (name: string) => {
      const projectIdentifier = projectKey ?? projectName
      const res = await fetch(`/api/projects/${encodeURIComponent(projectIdentifier)}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error || 'Failed to rename project')
    },
    onSuccess: async () => {
      setEditing(false)
      setError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['command-deck-projects'] }),
        queryClient.invalidateQueries({ queryKey: ['registered-projects'] }),
        queryClient.invalidateQueries({ queryKey: ['session-trees'] }),
      ])
    },
    onError: (mutationError: Error) => {
      committingRef.current = false
      setError(mutationError.message)
    },
  })

  const begin = useCallback(() => {
    committingRef.current = false
    draftNameRef.current = projectName
    setDraftName(projectName)
    setError(null)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }, [projectName])

  const change = useCallback((value: string) => {
    setDraftName(value)
    draftNameRef.current = value
    setError(null)
  }, [])

  const commit = useCallback(() => {
    if (committingRef.current) return
    committingRef.current = true
    renameMutation.mutate(draftNameRef.current)
  }, [renameMutation])

  const cancel = useCallback(() => {
    setEditing(false)
    setDraftName('')
    setError(null)
  }, [])

  return {
    editing,
    draftName,
    error,
    pending: renameMutation.isPending,
    inputRef,
    begin,
    change,
    commit,
    cancel,
  }
}
