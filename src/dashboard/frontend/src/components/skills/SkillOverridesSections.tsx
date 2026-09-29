/**
 * Collapsed-by-default hosts for the skill overrides panel (PAN-3942): the
 * project settings "Skills" subsection and the issue view "Skills for this
 * issue" section. Nothing is fetched until the operator opens one.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useBackendPanes } from '../../lib/store';
import { cn } from '../../lib/utils';
import { SkillOverridesPanel } from './SkillOverridesPanel';

function Disclosure({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex items-center gap-2 text-[13px] text-foreground">
        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
        {title}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function ProjectSkillsSection({ projectKey }: { projectKey: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 border-t border-border pt-3" data-section="ProjectSkills">
      <Disclosure title="Skills" open={open} onToggle={() => setOpen(value => !value)}>
        <SkillOverridesPanel level="project" projectKey={projectKey} enabled={open} />
      </Disclosure>
    </div>
  );
}

const LIVE_PANE_STATES = new Set(['idle', 'working', 'blocked']);

export function IssueSkillsSection({ issueId }: { issueId: string }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const panes = useBackendPanes(issueId);
  const liveAgents = panes.filter(pane => LIVE_PANE_STATES.has(pane.state)).map(pane => `${pane.role} agent`);
  const hide = useCallback(() => setHidden(true), []);
  if (hidden) return null;
  return (
    <div data-section="SkillOverrides" className="rounded-md border border-border px-[14px] py-[12px]">
      <Disclosure title="Skills for this issue" open={open} onToggle={() => setOpen(value => !value)}>
        <SkillOverridesPanel level="issue" issueId={issueId} enabled={open} onUnavailable={hide} liveAgents={liveAgents} />
      </Disclosure>
    </div>
  );
}
