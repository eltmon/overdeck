/**
 * PAN-2398 — the Crew stage: who is doing what on this issue, right now.
 * Design contract: docs/design/mockups/issue-cockpit-redesign.html §crew.
 *
 * Members come from the issue's live session tree (the same SessionNode data
 * the tree lane collects): work/strike sessions are the tier crew, the
 * review-supervisor session is the supervisor, planning/review/test sessions
 * group as specialists. States use the non-technical vocabulary — working
 * (glowing blue, actively spending tokens), listening (teal ring, reading the
 * commit stream for nearly nothing), reviewing (violet), done (faded).
 *
 * Clicking a member opens that member's session — the operator sees exactly
 * what it is seeing and writing, via the existing session panel.
 */

import type { SessionNode } from '@overdeck/contracts'
import { ActiveAgentPanel } from '../../issue-view/ActiveAgentPanel'
import { compactModelName, initialsFor } from '../../../lib/model-names'

type CrewState = 'working' | 'listening' | 'reviewing' | 'idle' | 'done'

interface CrewMember {
  session: SessionNode
  label: string
  sub: string
  state: CrewState
  initials: string
}

function slotLabel(session: SessionNode): string {
  const source = session.tmuxSession ?? session.sessionId
  const slot = source.match(/-slot-(\d+)/)?.[1]
  return slot ? `slot ${slot}` : (session.role ?? session.type)
}

const STATE_COPY: Record<CrewState, string> = {
  working: 'working',
  listening: 'listening',
  reviewing: 'reviewing',
  idle: 'waiting',
  done: 'done for now',
}
const STATE_TEXT: Record<CrewState, string> = {
  working: 'text-blue-500',
  listening: 'text-teal-500',
  reviewing: 'text-violet-500',
  idle: 'text-muted-foreground',
  done: 'text-muted-foreground/70',
}
const AVATAR_CLASS: Record<CrewState, string> = {
  working: 'border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.15)] animate-pulse',
  listening: 'border-teal-500',
  reviewing: 'border-violet-500 shadow-[0_0_0_3px_rgba(139,92,246,0.15)] animate-pulse',
  idle: 'border-border',
  done: 'border-border opacity-55',
}

function isSupervisor(session: SessionNode): boolean {
  const id = session.tmuxSession ?? session.sessionId
  return id.includes('-supervisor') || session.role === 'supervisor'
}

export function deriveCrew(sessions: readonly SessionNode[]): { tiers: CrewMember[]; supervisor: CrewMember | null; specialists: CrewMember[] } {
  const tiers: CrewMember[] = []
  const specialists: CrewMember[] = []
  let supervisor: CrewMember | null = null

  for (const session of sessions) {
    const model = compactModelName(session.model)
    if (isSupervisor(session)) {
      supervisor = {
        session,
        label: `supervisor · ${model}`,
        sub: session.presence === 'active' ? 'reviewing a commit' : session.presence === 'ended' ? 'done for now' : 'standing by',
        state: session.presence === 'active' ? 'reviewing' : session.presence === 'ended' ? 'done' : 'idle',
        initials: initialsFor(session.model),
      }
      continue
    }
    if (session.type === 'work' || session.type === 'strike') {
      const state: CrewState = session.presence === 'active' ? 'working'
        : session.presence === 'idle' ? 'listening'
        : session.presence === 'ended' ? 'done' : 'idle'
      tiers.push({
        session,
        label: `${model} · ${slotLabel(session)}`,
        sub: STATE_COPY[state],
        state,
        initials: initialsFor(session.model),
      })
      continue
    }
    if (session.type === 'planning' || session.type === 'review' || session.type === 'reviewer' || session.type === 'test') {
      const state: CrewState = session.presence === 'active' ? 'working' : session.presence === 'ended' ? 'done' : 'idle'
      specialists.push({
        session,
        label: `${session.type} · ${model}`,
        sub: STATE_COPY[state],
        state,
        initials: initialsFor(session.model),
      })
    }
  }
  return { tiers, supervisor, specialists }
}

function MemberBadge({ member, onSelect }: { member: CrewMember; onSelect: (session: SessionNode) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(member.session)}
      className="w-[118px] shrink-0 text-center"
      title="Open this member's session — see exactly what it's seeing and writing"
      data-testid="crew-member"
      data-state={member.state}
    >
      <div className={`mx-auto mb-1.5 grid h-[50px] w-[50px] place-items-center rounded-[14px] border-[1.5px] bg-muted font-['Space_Grotesk'] text-[14px] font-semibold text-foreground ${AVATAR_CLASS[member.state]}`}>
        {member.initials}
      </div>
      <div className="truncate text-[11.5px] font-semibold text-foreground">{member.label}</div>
      <div className={`text-[10.5px] ${STATE_TEXT[member.state]}`}>{member.sub}</div>
    </button>
  )
}

export function CrewStage({ sessions, onSelectSession }: {
  sessions: readonly SessionNode[]
  onSelectSession: (session: SessionNode) => void
}) {
  const { tiers, supervisor, specialists } = deriveCrew(sessions)
  if (tiers.length === 0 && !supervisor && specialists.length === 0) return null
  const liveListeners = tiers.filter((member) => member.state === 'working' || member.state === 'listening').length

  return (
    <div className="rounded-[14px] border border-border bg-card p-4" data-testid="crew-stage">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="font-['Space_Grotesk'] text-[13.5px] font-semibold text-foreground">The crew</div>
        <div className="text-[11px] text-muted-foreground">glow = actively spending · teal ring = reading the stream · faded = finished</div>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        {tiers.map((member) => <MemberBadge key={member.session.sessionId} member={member} onSelect={onSelectSession} />)}
        {supervisor && (
          <div className="ml-auto border-l border-border pl-3">
            <MemberBadge member={supervisor} onSelect={onSelectSession} />
          </div>
        )}
      </div>
      {liveListeners >= 2 && (
        <div className="relative mt-3 h-[30px] overflow-hidden rounded-full bg-muted" data-testid="commit-river">
          <span className="absolute left-3 top-[7px] z-[1] text-[10.5px] text-muted-foreground">commit stream — every member reads every change</span>
          <span className="absolute top-[9px] h-3 w-3 animate-[crewflow_7s_linear_infinite] rounded-[3px] bg-teal-500" />
          <span className="absolute top-[9px] h-3 w-3 animate-[crewflow_7s_linear_2.4s_infinite] rounded-[3px] bg-blue-500" />
          <style>{'@keyframes crewflow{from{left:-4%}to{left:102%}}'}</style>
        </div>
      )}
      {specialists.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          {specialists.map((member) => (
            <button
              key={member.session.sessionId}
              type="button"
              onClick={() => onSelectSession(member.session)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40"
            >
              <span className={`h-2 w-2 rounded-full ${member.state === 'working' ? 'bg-blue-500 animate-pulse' : member.state === 'done' ? 'bg-muted-foreground/40' : 'bg-muted-foreground'}`} />
              {member.label}
            </button>
          ))}
        </div>
      )}
      {tiers[0] && (
        <ActiveAgentPanel
          agentId={tiers[0].session.sessionId}
          density="cockpit"
          className="mt-3"
          title="Active work agent"
        />
      )}
    </div>
  )
}

export default CrewStage
