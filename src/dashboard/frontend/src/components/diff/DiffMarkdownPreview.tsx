// The Markdown Preview body for the diff panel (PAN-5338 WI-3).

import { useQuery } from '@tanstack/react-query'

import { MarkdownTab } from '../CommandDeck/ZoneCOverviewTabs/MarkdownTab'
import { explorerErrorMessage, readFile } from '../explorer/explorer-rpc'
import { SHOWING_CURRENT_FILE, type PreviewSource } from './markdownPreviewSource'

export function DiffMarkdownPreview({ source }: { source: PreviewSource }) {
  return (
    <div data-testid="diff-markdown-preview" className="h-full min-h-0 overflow-auto">
      <DiffMarkdownPreviewBody source={source} />
    </div>
  )
}

function DiffMarkdownPreviewBody({ source }: { source: PreviewSource }) {
  if (source.kind === 'patch') {
    return <MarkdownTab body={source.text} plainRelativeLinks />
  }

  if (source.kind === 'unavailable') {
    return <p className="px-3 py-3 text-xs text-muted-foreground">{source.message}</p>
  }

  return <DiffMarkdownPreviewRead source={source} />
}

function DiffMarkdownPreviewRead({
  source,
}: {
  source: Extract<PreviewSource, { kind: 'read' }>
}) {
  const { rootId, path, ref, note } = source
  const query = useQuery({
    queryKey: ['diff-md-preview', rootId, path, ref ?? 'worktree'],
    queryFn: () => readFile(rootId, path, ref),
    staleTime: 4000,
  })

  if (query.isPending) return <MarkdownTab body={undefined} isLoading />
  if (query.isError) {
    return (
      <p className="px-3 py-3 text-xs text-destructive">
        {`Couldn't read this file: ${explorerErrorMessage(query.error)}`}
      </p>
    )
  }
  if (query.data.kind !== 'text') {
    return <p className="px-3 py-3 text-xs text-muted-foreground">This file is too large to preview.</p>
  }

  return (
    <>
      {note && <p data-testid="diff-preview-note" className="px-3 py-2 text-xs text-muted-foreground">{SHOWING_CURRENT_FILE}</p>}
      <MarkdownTab body={query.data.text} plainRelativeLinks />
    </>
  )
}
