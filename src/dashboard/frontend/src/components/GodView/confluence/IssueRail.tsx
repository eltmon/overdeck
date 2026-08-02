import type { Agent } from '../../../types';
import { STAGES, STAGE_COLORS, ROLE_COLORS, PROJECT_RING, fmtAge } from './model';
import type { ConfluenceOrb, HookStreamEntry } from './useConfluenceData';

/** Operator-reopened D-3 (PAN-3447): clicking an orb slides this rail in over the
 * canvas — the mockup's issue-rail UX — instead of leaving the god view for the
 * issue page. The real issue page stays one click away via the action button. */

interface IssueRailProps {
  orb: ConfluenceOrb;
  agents: readonly Agent[];
  entries: readonly HookStreamEntry[];
  onClose: () => void;
  onOpenIssue: (issueId: string) => void;
}

function trackerUrl(issueId: string): string | null {
  const pan = /^PAN-(\d+)$/.exec(issueId);
  if (pan?.[1]) return `https://github.com/eltmon/overdeck/issues/${pan[1]}`;
  const krux = /^KRUX-(\d+)$/.exec(issueId);
  if (krux?.[1]) return `https://github.com/eltmon/krux/issues/${krux[1]}`;
  return null;
}

function stateLabel(orb: ConfluenceOrb): string {
  if (orb.state === 'stale') return 'stale ❄';
  if (orb.state === 'shelf') return 'yielded ⏸';
  if (orb.state === 'failed') return 'merge failed ✗';
  return 'active';
}

function relativeAge(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
}

function chip(text: string, color: string) {
  return (
    <span key={text} className="confluence-rail-chip" style={{ color, borderColor: `${color}66`, background: `${color}14` }}>
      {text}
    </span>
  );
}

export function IssueRail({ orb, agents, entries, onClose, onOpenIssue }: IssueRailProps) {
  const projectColor = PROJECT_RING[orb.project as keyof typeof PROJECT_RING] ?? STAGE_COLORS.PLAN;
  const stageColor = STAGE_COLORS[orb.stage];
  const roleColor = ROLE_COLORS[orb.role as keyof typeof ROLE_COLORS] ?? STAGE_COLORS.WORK;
  const stageIndex = STAGES.indexOf(orb.stage);
  const recent = entries.slice(-8).reverse();
  const tracker = trackerUrl(orb.id);

  return (
    <aside className="confluence-rail" aria-label={`Issue rail for ${orb.id}`}>
      <div className="confluence-rail-head">
        <span className="confluence-rail-id" style={{ color: projectColor }}>{orb.id}</span>
        {chip(orb.stage, stageColor)}
        <button type="button" className="confluence-rail-close" title="Close (Esc)" onClick={onClose}>✕</button>
      </div>
      {orb.title && orb.title !== orb.id && <div className="confluence-rail-title">{orb.title}</div>}
      <div className="confluence-rail-chips">
        {chip(orb.role, roleColor)}
        {chip(orb.project, projectColor)}
        {chip(stateLabel(orb), 'var(--gv-text-secondary)')}
        {orb.labels.map((label) => chip(label, 'var(--gv-text-secondary)'))}
      </div>

      <h4>pipeline</h4>
      <div className="confluence-rail-stepper">
        {STAGES.map((stage, index) => (
          <div key={stage} className={`confluence-rail-step ${index < stageIndex ? 'done' : index === stageIndex ? 'now' : ''}`}>
            <div className="confluence-rail-step-dot" />
            <div className="confluence-rail-step-name">{stage}</div>
          </div>
        ))}
      </div>

      <h4>agents on this issue</h4>
      {agents.length === 0 && <div className="confluence-rail-empty">no live agents right now</div>}
      {agents.map((agent) => (
        <div key={agent.id} className="confluence-rail-agent">
          <span className="confluence-rail-agent-dot" style={{ background: ROLE_COLORS[(agent.role ?? 'work') as keyof typeof ROLE_COLORS] ?? STAGE_COLORS.WORK }} />
          <span className="confluence-rail-agent-id">{agent.id}</span>
          <span className="confluence-rail-agent-meta">{agent.status}{agent.model ? ` · ${agent.model}` : ''}</span>
        </div>
      ))}

      <h4>vitals</h4>
      <div className="confluence-rail-vitals">
        <div className="confluence-rail-stat">
          <div className="confluence-rail-stat-value" style={{ color: 'var(--gv-blue)' }}>
            {orb.state === 'active' ? `${entries.length}/min` : '—'}
          </div>
          <div className="confluence-rail-stat-key">hook events</div>
        </div>
        <div className="confluence-rail-stat">
          <div className="confluence-rail-stat-value" style={{ color: orb.state === 'stale' ? '#9fc7ff' : 'var(--gv-green)' }}>
            {orb.state === 'stale' ? `❄ ${fmtAge(orb.staleMin)}` : 'live'}
          </div>
          <div className="confluence-rail-stat-key">freshness</div>
        </div>
      </div>

      {orb.yieldReason && <div className="confluence-rail-banner amber">⏸ {orb.yieldReason}</div>}
      {orb.warn && !orb.broken && <div className="confluence-rail-banner amber">⚠ {orb.warn}</div>}
      {orb.broken && <div className="confluence-rail-banner red">⚠ workspace stack broken underneath the agent</div>}
      {orb.state === 'failed' && <div className="confluence-rail-banner pink">✗ merge to main failed — needs an operator</div>}
      {orb.state === 'stale' && (
        <div className="confluence-rail-banner ice">❄ frozen — no hook activity for {fmtAge(orb.staleMin)}</div>
      )}

      <h4>recent events</h4>
      {recent.length === 0 && <div className="confluence-rail-empty">no hook events in the last minute</div>}
      {recent.map((entry) => (
        <div key={entry.sequence} className="confluence-rail-event">
          <span className="confluence-rail-event-hook">{entry.hookName}</span>
          <span className="confluence-rail-event-tool">{entry.tool}</span>
          <span className="confluence-rail-event-age">{relativeAge(entry.ts)}</span>
        </div>
      ))}

      <div className="confluence-rail-actions">
        <button type="button" className="confluence-rail-button" onClick={() => onOpenIssue(orb.id)}>
          Open issue page →
        </button>
        {tracker && (
          <a className="confluence-rail-button ghost" href={tracker} target="_blank" rel="noopener noreferrer">
            Tracker ↗
          </a>
        )}
      </div>
      <div className="confluence-rail-foot">inspect live: <b>pan show {orb.id.toLowerCase()}</b></div>
    </aside>
  );
}
