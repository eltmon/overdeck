import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import type { PullRequestLinkedConversation } from '@overdeck/contracts'
import { useDashboardStore } from '../../../lib/store'

const SOURCE_LABEL: Record<PullRequestLinkedConversation['source'], string> = {
  manual: 'linked by hand',
  agent: 'linked by an agent',
  created: 'opened by the pipeline',
  branch: 'same branch',
}

async function fetchLinkedConversations(url: string): Promise<PullRequestLinkedConversation[]> {
  const res = await fetch(`/api/pull-requests/conversations?url=${encodeURIComponent(url)}`)
  if (!res.ok) return []
  const data = (await res.json()) as { conversations?: PullRequestLinkedConversation[] }
  return data.conversations ?? []
}

/**
 * The conversations linked to a PR (PAN-3822 reverse index), shown in the
 * issue cockpit's Code card. Refetches whenever any conversation's PR links
 * change (`conversation.pull_requests_changed` bumps the list revision).
 */
export function LinkedConversations({ prUrl }: { prUrl: string }) {
  const queryClient = useQueryClient()
  const revision = useDashboardStore((s) => s.conversationsListRevision)
  const { data: conversations = [] } = useQuery({
    queryKey: ['pull-request-conversations', prUrl],
    queryFn: () => fetchLinkedConversations(prUrl),
    staleTime: 30_000,
  })

  useEffect(() => {
    if (revision > 0) void queryClient.invalidateQueries({ queryKey: ['pull-request-conversations', prUrl] })
  }, [revision, prUrl, queryClient])

  if (conversations.length === 0) return null
  return (
    <div className="mt-3 flex flex-col gap-1" aria-label="Linked conversations">
      <div className="text-[11px] text-muted-foreground">Linked conversations</div>
      {conversations.map((conversation) => (
        <a
          key={conversation.name}
          href={`/conv/${conversation.id}`}
          className="flex min-w-0 items-center gap-2 text-[12px] hover:underline"
          title={conversation.name}
        >
          <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{conversation.title || conversation.name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{SOURCE_LABEL[conversation.source]}</span>
        </a>
      ))}
    </div>
  )
}
