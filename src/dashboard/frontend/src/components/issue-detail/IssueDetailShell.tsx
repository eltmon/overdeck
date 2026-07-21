/**
 * PAN-2908 · C-DETAIL — the ONE issue-detail anatomy.
 *
 * The phase rail + specialist strip, shared by every issue shell (drawer
 * density today, cockpit header, rail tomorrow). Both double as the per-agent
 * conversation switcher: the host supplies the agents and one callback —
 * `onOpenAgentConversation(agentId)` — and the shell handles phase/specialist
 * selection, active tracking, and chip derivation. One component, one
 * vocabulary, one place to fix.
 */
import { useMemo } from 'react';
import type { Agent, WorkAgentLifecycle } from '../../types';
import type { ReviewStatusSnapshot, SessionNode } from '@overdeck/contracts';
import IssuePhaseRail from './IssuePhaseRail';
import { SpecialistStrip } from './SpecialistStrip';
import { agentsToReviewerSessions, deriveSpecialistChips } from './deriveSpecialists';
import type { Phase } from '../../lib/simple/phases';

const ENDED_STATUSES = new Set(['stopped', 'dead', 'failed']);

export interface IssueDetailShellProps {
  issueId?: string | null;
  agents: Agent[];
  reviewStatus?: ReviewStatusSnapshot | undefined;
  /** Reviewer sessions from the session tree (cockpit). When absent, chips
   *  derive from the agents list (drawer). */
  reviewerSessions?: SessionNode[];
  /** The currently selected agent — drives rail/strip active markers. */
  activeAgentId?: string | null;
  /** The host's conversation switcher for specialist chips. */
  onOpenAgentConversation: (agentId: string) => void;
  /** Optional host override for phase clicks (e.g. the cockpit's session-tree
   *  flow). Default: pick the phase's agent from `agents` and switch. */
  onSelectPhase?: (phase: Phase) => void;
  lifecycle?: WorkAgentLifecycle | null;
  className?: string;
}

function pickPhaseAgent(agents: Agent[], phase: Phase): Agent | undefined {
  const candidates = agents.filter((agent) => agent.role === phase);
  return (
    candidates.find((agent) => !ENDED_STATUSES.has(agent.status))
    ?? candidates.find((agent) => agent.id.endsWith('-review-supervisor'))
    ?? candidates[0]
  );
}

export function IssueDetailShell({
  issueId,
  agents,
  reviewStatus,
  reviewerSessions,
  activeAgentId,
  onOpenAgentConversation,
  onSelectPhase,
  className,
}: IssueDetailShellProps) {
  const chips = useMemo(
    () => deriveSpecialistChips(reviewerSessions ?? agentsToReviewerSessions(agents), reviewStatus),
    [reviewerSessions, agents, reviewStatus],
  );
  const activePhase = useMemo<Phase | null>(() => {
    const agent = agents.find((candidate) => candidate.id === activeAgentId);
    const role = agent?.role;
    return role === 'plan' || role === 'work' || role === 'review' || role === 'test' || role === 'ship' ? role : null;
  }, [agents, activeAgentId]);
  const activeReviewerRole = useMemo(() => {
    if (!activeAgentId) return null;
    const match = /-review-([a-z]+)$/i.exec(activeAgentId);
    return match ? match[1].toLowerCase() : null;
  }, [activeAgentId]);

  const handlePhase = onSelectPhase ?? ((phase: Phase) => {
    const agent = pickPhaseAgent(agents, phase);
    if (agent) onOpenAgentConversation(agent.id);
  });

  return (
    <div data-component="issue-detail-shell" data-section="Pipeline Band" className={className}>
      <IssuePhaseRail
        issueId={issueId ?? undefined}
        activePhase={activePhase}
        onSelectPhase={handlePhase}
      />
      {chips.length > 0 && (
        <div className="mt-2" data-section="SpecialistStrip">
          <SpecialistStrip
            specialists={chips}
            activeId={activeReviewerRole}
            onSelect={(chip) => {
              const agent = agents.find((candidate) => candidate.id.toLowerCase().endsWith(`-review-${chip.id.toLowerCase()}`));
              if (agent) onOpenAgentConversation(agent.id);
            }}
          />
        </div>
      )}
    </div>
  );
}
