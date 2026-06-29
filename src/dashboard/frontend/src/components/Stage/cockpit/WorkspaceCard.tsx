import { ExternalLink } from 'lucide-react'
import { useWorkspaceQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { useIssueActions, type IssueActionView } from '../../IssueActionMenu/useIssueActions'
import { UatStackStatus } from '../../CommandDeck/UatStackStatus'
import { CockpitCard } from './CockpitCard'

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-1.5 text-[12px] last:border-b-0">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  )
}

/**
 * WorkspaceCard — the issue's workspace at a glance: path · services ·
 * containers · attach, plus the workspace lifecycle actions (sync-main,
 * containerize) pulled from the real action registry. (Command Deck remodel S3.)
 */
export function WorkspaceCard({ issueId }: { issueId: string }) {
  const wsQuery = useWorkspaceQuery(issueId)
  const actions = useIssueActions(issueId)
  const ws = wsQuery.data

  if (!ws?.exists) {
    return (
      <CockpitCard tone="info" title="Workspace">
        <div className="text-[12px] text-muted-foreground">
          {wsQuery.isLoading ? 'Loading…' : 'No workspace.'}
        </div>
      </CockpitCard>
    )
  }

  const services = ws.services?.filter((s) => s.url) ?? []
  if (services.length === 0) {
    if (ws.frontendUrl) services.push({ name: 'Frontend', url: ws.frontendUrl })
    if (ws.apiUrl) services.push({ name: 'API', url: ws.apiUrl })
  }
  const pendingOperation = ws.pendingOperation && typeof ws.pendingOperation === 'object'
    ? ws.pendingOperation
    : null
  const stackPending = pendingOperation?.status === 'running' && (
    pendingOperation.type === 'containerize' ||
    pendingOperation.type === 'start' ||
    pendingOperation.type === 'rebuild-stack' ||
    pendingOperation.type === 'start-stack' ||
    pendingOperation.type === 'stop-stack' ||
    pendingOperation.type === 'restart-stack' ||
    pendingOperation.type === 'reap-workspace'
  )

  const wsActions = ['syncMain', 'createWorkspace']
    .map((key) => actions.all.find((v) => v.action.key === key))
    .filter((v): v is IssueActionView => !!v && v.enabled)

  return (
    <CockpitCard tone="info" title="Workspace">
      {ws.path && (
        <KV k="Path">
          <span className="font-mono text-[11px]" title={ws.path}>…/{ws.path.split('/').slice(-2).join('/')}</span>
        </KV>
      )}
      <KV k="Services">
        {services.length > 0 ? (
          <span className="inline-flex items-center gap-2">
            {services.map((s) => (
              <a
                key={s.name}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-info-foreground hover:underline"
              >
                {s.name} <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">none</span>
        )}
      </KV>
      <div className="border-b border-border py-2 last:border-b-0">
        <div className="mb-2 text-[12px] text-muted-foreground">UAT environment</div>
        <UatStackStatus
          containers={ws.containers}
          stackHealth={ws.stackHealth}
          frontendUrl={ws.frontendUrl}
          apiUrl={ws.apiUrl}
          pending={stackPending}
          density="full"
        />
        {!ws.containers && !ws.stackHealth && (
          <span className="text-[12px] text-muted-foreground">No container state available.</span>
        )}
      </div>
      {ws.agentSessionId && (
        <KV k="Attach">
          <span className="font-mono text-[11px] text-muted-foreground" title={`tmux -L overdeck attach -t ${ws.agentSessionId}`}>
            {ws.agentSessionId}
          </span>
        </KV>
      )}

      {wsActions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {wsActions.map((v) => (
            <button
              key={v.action.key}
              type="button"
              disabled={v.isPending}
              onClick={v.invoke}
              className="inline-flex items-center rounded-[var(--radius-sm)] border border-border px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-accent disabled:opacity-50"
            >
              {v.action.label}
            </button>
          ))}
        </div>
      )}
    </CockpitCard>
  )
}
