import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ViewMode } from '../chat/ConversationPanel'
import type { Conversation } from '../CommandDeck/ConversationList'
import { fetchRegisteredProjects, type RegisteredProject } from '../CommandDeck/UnknownProjectState'
import { NO_PROJECT_KEY } from '../CommandDeck/projectsData'
import { ProjectOverview, type IssueCostBreakdown } from '../CommandDeck/ProjectOverview'
import { bucketFeaturePhase, groupPipelineEntries, type BucketedFeature } from '../CommandDeck/pipeline-helpers'
import type { ProjectFeature } from '../CommandDeck/ProjectTree/ProjectNode'
import { useCreateConversation } from '../frame/deck/useCreateConversation'
import { useDashboardStore } from '../../lib/store'
import { useAgentsWorking } from '../../lib/selectors/agentsWorking'
import { useNeedsYouItems } from '../../lib/selectors/needsYou'
import { MergeTrain } from '../merge-train/train/MergeTrain'
import { navigateToIssue } from '../AgentPillPopoverRow'
import type { DerivedIssueState } from '../../types'
import { useProjectRename } from './HomePane/useProjectRename'
import { writeLastUsedAgent } from './HomePane/launcherOrdering'
import { HomeHeader } from './HomePane/HomeHeader'
import { HomeMetaLine } from './HomePane/HomeMetaLine'
import { HomeActions } from './HomePane/HomeActions'
import { HomeFacts } from './HomePane/HomeFacts'
import { HomeNeedsYou } from './HomePane/HomeNeedsYou'
import { RecentChanges } from './HomePane/RecentChanges'
import { StartIssueDialog } from './HomePane/StartIssueDialog'
import { useProjectChanges, useProjectSpend } from './HomePane/useHomeData'
import type { StageApi } from './types'
import home from './HomePane/home.module.css'

export interface ProjectHomeProps {
  /** Project key/name shown as the Home title. */
  projectName: string
  /** projects.yaml key — threaded to the cockpit settings panel (PAN-1693). */
  projectKey?: string
  /** Project working branch; defaults to `main`. */
  branch?: string
  /** Conversations already scoped to this project. */
  conversations?: Conversation[]
  /** Create a conversation for this project, returning its name or creation error. */
  onCreateConversation?: (agentId: string, message?: string, viewMode?: ViewMode) => Promise<{ name: string } | { error: string }>
  /** Project issues/features — when present, the Pipeline panel renders.
   * Absent during load / for the no-project deck. */
  features?: ProjectFeature[]
  /** Aggregated cost per issueId (and lowercased alias), shown in row tooltips. */
  issueCosts?: Record<string, number>
  /** Per-issue cost breakdown (by-model / by-stage). */
  issueCostDetails?: Record<string, IssueCostBreakdown>
  /** Open an issue's cockpit tab when its pipeline row is clicked. */
  onSelectFeature?: (feature: ProjectFeature) => void
  api: StageApi
}

/** `/api/registered-projects` returns more than the shared RegisteredProject type names. */
type RegisteredProjectRow = RegisteredProject & {
  linearTeam?: string | null
  githubRepo?: string | null
  gitlabRepo?: string | null
}

function navigate(path: string, tab: string) {
  window.history.pushState({ tab }, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function derivedForFeature(byId: Record<string, DerivedIssueState>, issueId: string): DerivedIssueState | undefined {
  return byId[issueId] ?? byId[issueId.toUpperCase()] ?? byId[issueId.toLowerCase()]
}

function singlePrefix(features: readonly ProjectFeature[] | undefined): string | null {
  const prefixes = new Set((features ?? []).map((f) => f.issueId.split('-')[0]?.toUpperCase()).filter(Boolean))
  return prefixes.size === 1 ? [...prefixes][0]! : null
}

/**
 * ProjectHome — the permanent HOME tab of a project deck, rebuilt in
 * PAN-5294 (mockup screen 2). One layout with three states (G-D1): the
 * no-project deck shows only the title and the action row; a registered
 * project adds the metadata line, facts, Needs you and Recent changes; with
 * loaded issues the Pipeline panel and merge train render too.
 */
export function ProjectHome({
  projectName,
  projectKey,
  branch = 'main',
  conversations = [],
  onCreateConversation,
  features,
  issueCosts,
  issueCostDetails,
  onSelectFeature,
  api,
}: ProjectHomeProps) {
  const [launchBusy, setLaunchBusy] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [startIssueOpen, setStartIssueOpen] = useState(false)
  const needsYouRef = useRef<HTMLElement>(null)
  const inReviewRef = useRef<HTMLDivElement>(null)

  const rename = useProjectRename(projectName, projectKey)
  const { data: registeredProjects } = useQuery({ queryKey: ['registered-projects'], queryFn: fetchRegisteredProjects })
  const registered = projectKey
    ? (registeredProjects as RegisteredProjectRow[] | undefined)?.find((p) => p.key === projectKey)
    : undefined

  // Called unconditionally (hooks cannot be conditional); ignored without a key.
  const agentsWorking = useAgentsWorking({ projectKey })
  const needsYouAll = useNeedsYouItems({ projectKey })
  const needsYou = projectKey ? needsYouAll : []
  const needsYouIssueIds = useMemo(
    () => new Set(needsYou.filter((item) => item.key.startsWith('issue:')).map((item) => item.key.slice('issue:'.length).toUpperCase())),
    [needsYou],
  )

  const changes = useProjectChanges(projectKey)
  const prefix = registered?.linearTeam ?? singlePrefix(features)
  const spend = useProjectSpend(projectKey ? prefix : null)

  const deckProjectKey = api.deckKey !== NO_PROJECT_KEY ? api.deckKey : undefined
  const { create } = useCreateConversation(api.deckKey)

  const derivedByIssueId = useDashboardStore((s) => s.derivedIssueStateByIssueId)
  const reviewEntries = useMemo(() => {
    const entries: BucketedFeature[] = (features ?? []).map((feature) => {
      const derived = derivedForFeature(derivedByIssueId, feature.issueId)
      return { feature, derived, phase: bucketFeaturePhase(feature, derived) }
    })
    return groupPipelineEntries(entries).find((group) => group.key === 'review')?.entries ?? []
  }, [features, derivedByIssueId])

  const onAgentSelected = async (id: string, message?: string) => {
    if (launchBusy) return
    writeLastUsedAgent(api.deckKey, id)
    setLaunchError(null)
    setLaunchBusy(true)
    try {
      const result = await onCreateConversation?.(id, message, 'terminal')
      if (result && 'name' in result) api.openOrFocusAgentPane(result.name, 'Agent')
      if (result && 'error' in result) setLaunchError(result.error)
    } finally {
      setLaunchBusy(false)
    }
  }

  const title = registered?.name ?? projectName
  const showPipeline = Boolean(projectKey && features && features.length > 0 && onSelectFeature)

  return (
    <div className={home.scroll} data-testid="project-home">
      <div className={home.inner}>
        <HomeHeader
          title={title}
          subtitle={projectKey ? registered?.githubRepo ?? registered?.gitlabRepo ?? undefined : undefined}
          rename={projectKey ? rename : undefined}
          projectKey={projectKey}
          meta={projectKey ? (
            <HomeMetaLine projectKey={projectKey} path={registered?.path} branch={changes.data?.branch ?? branch} />
          ) : undefined}
        />

        <HomeActions
          projectKey={projectKey}
          newConversationProjectKey={deckProjectKey}
          projectPath={registered?.path}
          hasIssuePrefix={Boolean(registered?.linearTeam)}
          busy={launchBusy}
          errorText={launchError ?? undefined}
          onNewConversation={() => void create(deckProjectKey)}
          onSelectAgent={(id) => void onAgentSelected(id)}
          onFiles={() => api.openDock?.({ tab: 'files' })}
          onChanges={() => api.openDock?.({ tab: 'changes' })}
          onTerminal={api.toggleTerminal}
          onWebPage={() => api.openPane({ paneType: 'browser', label: 'Web' })}
          onStartIssue={() => setStartIssueOpen(true)}
        />

        {projectKey && (
          <HomeFacts
            agents={agentsWorking}
            needsYou={needsYou}
            inReview={{
              count: reviewEntries.length,
              prNumbers: reviewEntries.flatMap((entry) => (entry.derived?.pr ? [entry.derived.pr.number] : [])),
            }}
            changes={changes}
            spend={spend.data ?? null}
            spendUnavailable={!prefix}
            onAgents={() => navigate('/agents', 'agents')}
            onNeedsYou={() => needsYouRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            onInReview={() => inReviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            onLanded={() => api.openDock?.({ tab: 'changes' })}
            onSpend={() => navigate('/costs', 'costs')}
          />
        )}

        {projectKey && needsYou.length > 0 && <HomeNeedsYou ref={needsYouRef} items={needsYou} />}

        {showPipeline && (
          <ProjectOverview
            projectName={projectName}
            projectKey={projectKey}
            features={features!}
            issueCosts={issueCosts ?? {}}
            issueCostDetails={issueCostDetails}
            onSelectFeature={onSelectFeature!}
            needsYouIssueIds={needsYouIssueIds}
            inReviewRef={inReviewRef}
          />
        )}

        {projectKey && !showPipeline && (
          // G-D1: with no issues loaded the Pipeline panel is hidden, but a
          // running merge train still shows (it renders nothing without one).
          <MergeTrain placement="project" projectKey={projectKey} active onNavigateIssue={navigateToIssue} />
        )}

        {projectKey && (
          <RecentChanges
            changes={changes}
            conversations={conversations}
            features={features ?? []}
            onOpenConversation={(name, conversationTitle) => api.openOrFocusAgentPane(name, conversationTitle)}
            onSelectFeature={(feature) => onSelectFeature?.(feature)}
            onAllChanges={() => api.openDock?.({ tab: 'changes' })}
          />
        )}

        {startIssueOpen && registered?.linearTeam && (
          <StartIssueDialog prefix={registered.linearTeam} features={features ?? []} onClose={() => setStartIssueOpen(false)} />
        )}
      </div>
    </div>
  )
}
