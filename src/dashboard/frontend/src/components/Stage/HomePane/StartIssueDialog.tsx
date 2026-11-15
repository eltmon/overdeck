import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useDashboardStore } from '../../../lib/store'
import { refreshDashboardState } from '../../../lib/refresh-dashboard-state'
import { useDeckDialogs } from '../../frame/deck/useIssueSessionActions'
import { hasActiveWorkSession } from '../../CommandDeck/pipeline-helpers'
import type { ProjectFeature } from '../../CommandDeck/ProjectTree/ProjectNode'
import type { DerivedIssueState, Issue } from '../../../types'
import { Modal } from '../../shared/Modal'
import { startIssueAgent } from './startIssue'

export interface StartIssueDialogProps {
  /** The project's issue prefix, used for the input placeholder (`<PREFIX>-123`). */
  prefix: string
  features: readonly ProjectFeature[]
  onClose: () => void
}

const MAX_LISTED = 12
const STARTABLE_STATES = new Set<DerivedIssueState['state'] | undefined>(['backlog', 'planned', undefined])

function derivedFor(byId: Record<string, DerivedIssueState>, issueId: string): DerivedIssueState | undefined {
  return byId[issueId] ?? byId[issueId.toUpperCase()] ?? byId[issueId.toLowerCase()]
}

function issueNumber(issueId: string): number {
  const n = Number(issueId.split('-').pop())
  return Number.isFinite(n) ? n : -1
}

/** Open the deck PlanDialog for `issueId` exactly as useIssueSessionActions' handleOpenPlanDialog does. */
function openPlanDialog(issueId: string) {
  const issues = useDashboardStore.getState().issuesRaw as Issue[]
  const found = issues.find((i) => i.identifier.toLowerCase() === issueId.toLowerCase())
  const issue = found ?? ({
    id: issueId, identifier: issueId, title: issueId, status: 'Todo',
    priority: 0, labels: [], url: '', createdAt: '', updatedAt: '',
  } as unknown as Issue)
  useDeckDialogs.getState().setPlanDialogIssue(issue)
}

const BUTTON = 'inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-[13px] text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60'
const PRIMARY = 'inline-flex h-9 items-center rounded-lg border border-primary bg-primary px-3 text-[13px] text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60'

/**
 * PAN-5294 G-D9 — Home's Start an issue dialog: type an id or pick one of
 * this project's startable issues. A planned issue starts its work agent;
 * anything else opens the deck PlanDialog.
 */
export function StartIssueDialog({ prefix, features, onClose }: StartIssueDialogProps) {
  const queryClient = useQueryClient()
  const derivedById = useDashboardStore((s) => s.derivedIssueStateByIssueId)
  const [value, setValue] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[] | null>(null)

  const startable = useMemo(
    () => features
      .filter((f) => STARTABLE_STATES.has(derivedFor(derivedById, f.issueId)?.state) && !hasActiveWorkSession(f))
      .sort((a, b) => issueNumber(b.issueId) - issueNumber(a.issueId))
      .slice(0, MAX_LISTED),
    [features, derivedById],
  )

  const issueId = value.trim().toUpperCase()
  const planned = issueId !== '' && derivedFor(derivedById, issueId)?.state === 'planned'
  const label = issueId === '' ? 'Start' : planned ? `Start ${issueId}` : `Plan ${issueId}…`

  const start = async (acknowledged: boolean) => {
    setPending(true)
    setError(null)
    const result = await startIssueAgent(issueId, { acknowledged })
    setPending(false)
    switch (result.kind) {
      case 'started':
        toast.success(`Started ${issueId}`)
        void refreshDashboardState(queryClient)
        onClose()
        return
      case 'needs-ack':
        setWarnings(result.warnings)
        return
      case 'recovery':
        onClose()
        return
      case 'codex-blocked':
      case 'error':
        setWarnings(null)
        setError(result.message)
    }
  }

  const submit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (!issueId || pending) return
    if (planned) {
      void start(false)
      return
    }
    openPlanDialog(issueId)
    onClose()
  }

  const pinned = warnings ? (
    <div role="alert" className="flex flex-col gap-2 text-[13px]">
      <p className="text-state-needs-you">Starting {issueId} needs your acknowledgement:</p>
      <ul className="list-disc pl-5 text-body-foreground">
        {warnings.map((warning) => <li key={warning}>{warning}</li>)}
      </ul>
    </div>
  ) : error ? (
    <p role="alert" className="text-[13px] text-destructive">{error}</p>
  ) : null

  return (
    <Modal
      title="Start an issue"
      onClose={onClose}
      onSubmit={submit}
      pinned={pinned}
      footer={<>
        <button type="button" className={BUTTON} onClick={onClose}>Cancel</button>
        {warnings ? (
          <button type="button" className={PRIMARY} disabled={pending} onClick={() => void start(true)}>
            Start anyway
          </button>
        ) : (
          <button type="submit" className={PRIMARY} disabled={!issueId || pending}>{label}</button>
        )}
      </>}
    >
      <label className="flex flex-col gap-1.5 text-[13px]">
        <span className="text-muted-foreground">Issue</span>
        <input
          aria-label="Issue"
          value={value}
          placeholder={`${prefix}-123`}
          onChange={(event) => {
            setValue(event.target.value)
            setWarnings(null)
            setError(null)
          }}
          className="h-9 rounded-md border border-border bg-background px-2.5 font-mono text-[13px] text-foreground outline-none focus:border-ring"
        />
      </label>
      {startable.length > 0 && (
        <div className="mt-3 flex flex-col" role="list" aria-label="Startable issues">
          {startable.map((feature) => (
            <button
              key={feature.issueId}
              type="button"
              role="listitem"
              onClick={() => {
                setValue(feature.issueId)
                setWarnings(null)
                setError(null)
              }}
              className="list-row grid items-center gap-3 rounded-md px-2 py-1.5 text-left"
              style={{ gridTemplateColumns: '92px minmax(0,1fr) 70px' }}
            >
              <span className="font-mono text-[12px] text-muted-foreground">{feature.issueId}</span>
              <span className="truncate text-[13px] text-foreground">{feature.title}</span>
              <span className="text-right text-[12px] text-muted-foreground">
                {derivedFor(derivedById, feature.issueId)?.state === 'planned' ? 'planned' : 'not planned'}
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
