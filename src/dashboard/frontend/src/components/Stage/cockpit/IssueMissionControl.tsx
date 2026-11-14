/**
 * PAN-5246: the Stage frame of the issue view. It owns the Stage route's tab
 * state and the Stage-only title-row extras (breadcrumb, Open tracker); the
 * view itself is IssueTitleRow + IssueDetail, the same components the drawer
 * renders.
 */
import { useState, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { IssueActionMenu } from '../../IssueActionMenu/IssueActionMenu'
import { selectAgents, useDerivedIssueState, useDashboardStore } from '../../../lib/store'
import { IssueDetail } from '../../issue-detail/IssueDetail'
import { resolveIssueTab } from '../../issue-detail/issueTabs'
import { IssueView } from '../../issue-view/IssueView'
import { IssueTitleRow } from '../../issue-view/IssueTitleRow'
import { useIssueRecord } from '../../issue-view/useIssueRecord'
import { MissionConversationTab } from './MissionConversationTab'
import type { PaneType } from '../../../lib/panesStore'
import { trackerIssueUrl } from '../../../lib/issueLinks'
import type { Agent } from '../../../types'

export interface IssueMissionControlProps {
  issueId: string
  title: string
  branch: string
  /** Active project name for the breadcrumb (e.g. "overdeck"). */
  projectName?: string
  launcher: ReactNode
  agentDock: ReactNode
  actionDock: ReactNode
  timeline: ReactNode
  onOpenPane: (paneType: PaneType) => void
}

/** The Stage tab's initial tab value: `?tab=` normalised, else Conversation (D-4). */
function stageTabFromUrl(): string {
  const raw = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tab')
  return resolveIssueTab(raw)?.value ?? 'conversation'
}

export function IssueMissionControl({ issueId, title, projectName, launcher, agentDock, actionDock, timeline }: IssueMissionControlProps) {
  // PAN-4560: the filter returns existing entries, so useShallow keeps the
  // array while this issue's agents are unchanged and another issue's agent
  // changes do not re-render the frame.
  const issueAgents = useDashboardStore(useShallow((s) =>
    (selectAgents(s) as Agent[]).filter((a) => a.issueId?.toLowerCase() === issueId.toLowerCase())))
  const derived = useDerivedIssueState(issueId)
  const record = useIssueRecord(issueId)
  const [tab, setTab] = useState<string>(stageTabFromUrl)
  const headerTitle = record.issue?.title
    || (title && title.toUpperCase() !== issueId.toUpperCase() ? title : null)
  const trackerHref = trackerIssueUrl(issueId, record.issue?.url)

  return (
    <IssueView issueId={issueId} density="cockpit" className="@container flex h-full min-h-0 flex-col bg-background">
      <header data-section="Header bar" className="shrink-0">
        <IssueTitleRow
          issueId={issueId}
          title={headerTitle ?? null}
          titleStatus={record.status}
          agents={issueAgents}
          trackerStatus={record.issue?.status}
          heading="h1"
          wrap
          leading={(
            <span data-testid="header-breadcrumb" className="hidden shrink-0 items-center gap-[6px] whitespace-nowrap text-[12px] text-muted-foreground @[900px]:inline-flex">
              {projectName ? <>{projectName} / </> : null}Issues /
            </span>
          )}
          actions={<IssueActionMenu issueId={issueId} mode="primary-strip" pinRight={['viewPr']} className="flex items-center gap-1" />}
          trailing={trackerHref ? (
            <a
              data-testid="header-tracker-link"
              href={trackerHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-[26px] shrink-0 items-center gap-[6px] rounded-[var(--radius)] border border-border px-[9px] text-[12px] font-medium text-body-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ExternalLink aria-hidden className="h-[14px] w-[14px]" />Open tracker
            </a>
          ) : null}
        />
      </header>
      <IssueDetail
        issueId={issueId}
        density="page"
        agents={issueAgents}
        derived={derived}
        tab={tab}
        onSelectTab={setTab}
        detailsFooter={<MissionConversationTab launcher={launcher} agentDock={agentDock} actionDock={actionDock} timeline={timeline} />}
      />
    </IssueView>
  )
}
