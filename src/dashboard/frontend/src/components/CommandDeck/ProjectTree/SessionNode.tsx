import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useLiveFlash } from '../../../lib/useLiveFlash';
import type { SessionNode as SessionNodeType } from '@panctl/contracts';
import { StatusDot, type StatusDotStatus } from '../StatusDot';
import { useAvailableModels, type ModelGroup } from '../../shared/ModelPicker/ModelPicker';
import { useDashboardStore } from '../../../lib/store';
import styles from '../styles/command-deck.module.css';

function stalenessColor(ms: number): string {
  if (ms < 2 * 60_000)  return 'var(--success)';
  if (ms < 10 * 60_000) return 'var(--warning)';
  if (ms < 30 * 60_000) return 'var(--orange, #f97316)';
  return 'var(--destructive)';
}

function formatLastHeard(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ago`;
  if (m > 0) return `${m}m ${s % 60}s ago`;
  return `${s}s ago`;
}

function LiveLastHeard({ lastActivity }: { lastActivity?: string }) {
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('var(--muted-foreground)');

  useEffect(() => {
    if (!lastActivity) return;
    const update = () => {
      const ms = Date.now() - new Date(lastActivity).getTime();
      if (ms < 60_000) { setLabel(''); return; }
      setLabel(formatLastHeard(ms));
      setColor(stalenessColor(ms));
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [lastActivity]);

  if (!lastActivity || !label) return null;

  return (
    <span
      style={{
        fontSize: 10,
        fontVariantNumeric: 'tabular-nums',
        color,
        flexShrink: 0,
      }}
      title={`Last heard: ${label}`}
    >
      {label}
    </span>
  );
}

let resolvedModelsCache: Record<string, string | null> | null = null;
let resolvedModelsFetchPromise: Promise<Record<string, string | null>> | null = null;

function useResolvedModels(): Record<string, string | null> {
  const [models, setModels] = useState<Record<string, string | null>>(resolvedModelsCache ?? {});

  useEffect(() => {
    if (resolvedModelsCache) {
      setModels(resolvedModelsCache);
      return;
    }
    if (!resolvedModelsFetchPromise) {
      resolvedModelsFetchPromise = fetch('/api/models/resolve')
        .then(r => r.json())
        .then((data: Record<string, string | null>) => {
          resolvedModelsCache = data;
          return data;
        })
        .catch(() => ({}));
    }
    resolvedModelsFetchPromise.then(data => setModels(data)).catch(() => {});
  }, []);

  return models;
}

function presenceToStatus(presence: SessionNodeType['presence']): StatusDotStatus {
  switch (presence) {
    case 'active': return 'active';
    case 'idle': return 'idle';
    case 'suspended': return 'waiting';
    case 'ended': return 'ended';
    default: return 'ended';
  }
}

interface SessionNodeProps {
  session: SessionNodeType;
  issueId?: string;
  isSelected?: boolean;
  onClick?: () => void;
  onStopSession?: (sessionId: string) => void;
  onViewTerminal?: (sessionId: string) => void;
  onPauseSession?: (sessionId: string) => void;
  onResumeSession?: (sessionId: string) => void;
  onRestartSession?: (sessionId: string, issueId: string, sessionType?: string, role?: string, model?: string) => void;
  onDeepWipe?: (issueId: string) => void;
  onOpenStateDir?: (sessionId: string) => void;
  onViewJsonl?: (sessionId: string) => void;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

function TypeBadge({ type, role }: { type: SessionNodeType['type']; role?: string }) {
  const label = role && type === 'reviewer' ? `${type}:${role}` : type;
  return <span className={styles.sessionTypeBadge}>{label}</span>;
}

function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function deriveSessionLabel(session: SessionNodeType): string {
  const model = session.model && session.model !== 'unknown' && session.model !== 'specialist'
    ? session.model
    : '';
  switch (session.type) {
    case 'merge': return 'Merge agent';
    case 'test': return 'Tests';
    case 'review': return 'Review';
    case 'reviewer': return session.role ? `${capitalize(session.role)} reviewer` : 'Reviewer';
    case 'work': return model ? `Work agent (${model})` : 'Work agent';
    case 'planning': return model ? `Planning (${model})` : 'Planning';
    case 'legacy': return 'Planning state';
    default: return session.type;
  }
}

interface ContextMenuState {
  x: number;
  y: number;
  open: boolean;
}

function MenuItem({
  label,
  onClick,
  variant = 'default',
}: {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'danger';
}) {
  return (
    <button
      style={{
        display: 'block',
        width: '100%',
        padding: '6px 12px',
        border: 'none',
        background: 'none',
        textAlign: 'left',
        cursor: 'pointer',
        color: variant === 'danger' ? 'var(--destructive)' : 'var(--foreground)',
        fontSize: 12,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function MenuDivider() {
  return (
    <div
      style={{
        height: 1,
        background: 'var(--border)',
        margin: '4px 8px',
      }}
    />
  );
}

function RestartSubmenu({
  defaultModel,
  groups,
  label,
  onRestart,
}: {
  defaultModel: string | null;
  groups: ModelGroup[];
  label?: string;
  onRestart: (model?: string) => void;
}) {
  const [showModels, setShowModels] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowModels(true);
  };
  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => setShowModels(false), 200);
  };

  const defaultLabel = defaultModel
    ? defaultModel.replace(/^claude-/, '').replace(/-\d{8}$/, '')
    : 'default';

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '6px 12px',
          border: 'none',
          background: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          color: 'var(--foreground)',
          fontSize: 12,
          gap: 8,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
        onClick={() => onRestart()}
      >
        <span>{label ? `${label} (${defaultLabel})` : `Restart (${defaultLabel})`}</span>
        <ChevronRight size={10} style={{ flexShrink: 0, opacity: 0.5 }} />
      </button>

      {showModels && (
        <div
          style={{
            position: 'absolute',
            left: '100%',
            top: 0,
            zIndex: 1001,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            padding: '4px 0',
            minWidth: 180,
            maxHeight: 300,
            overflowY: 'auto',
            fontSize: 12,
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {groups.map((group) => (
            <div key={group.provider}>
              <div style={{
                padding: '4px 12px 2px',
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--muted-foreground)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                {group.label}
              </div>
              {group.models.map((m) => (
                <button
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '4px 12px',
                    border: 'none',
                    background: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: m.id === defaultModel ? 'var(--primary)' : 'var(--foreground)',
                    fontSize: 12,
                    fontWeight: m.id === defaultModel ? 600 : 400,
                    gap: 8,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                  onClick={() => onRestart(m.id)}
                >
                  <span>{m.label}</span>
                  {m.costDisplay && (
                    <span style={{ opacity: 0.5, fontSize: 10 }}>{m.costDisplay}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SessionNode({
  session,
  issueId,
  isSelected,
  onClick,
  onStopSession,
  onViewTerminal,
  onPauseSession,
  onResumeSession,
  onRestartSession,
  onDeepWipe,
  onOpenStateDir,
  onViewJsonl,
  expandable,
  expanded,
  onToggleExpand,
}: SessionNodeProps) {
  const [menu, setMenu] = useState<ContextMenuState>({ x: 0, y: 0, open: false });
  const menuRef = useRef<HTMLDivElement>(null);
  const { groups } = useAvailableModels();
  const resolvedModels = useResolvedModels();

  // Subscribe to runtime snapshot for live lastActivity (same pattern as ZoneB)
  const runtime = useDashboardStore((s) => s.agentRuntimeById[session.sessionId]);
  const lastActivity = runtime?.lastActivity;

  // Live flash when presence or status changes (blocker-8)
  const flashKey = `${session.sessionId}:${session.presence}:${session.status}`;
  const flashClass = useLiveFlash(flashKey, 'anim-row-flash', 600);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, open: true });
  }, []);

  const closeMenu = useCallback(() => {
    setMenu((m) => ({ ...m, open: false }));
  }, []);

  // Close menu on click outside or scroll
  useEffect(() => {
    if (!menu.open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const handleScroll = () => closeMenu();
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [menu.open, closeMenu]);

  const canPause = session.presence === 'active' && onPauseSession;
  const canResume = session.presence === 'suspended' && onResumeSession;
  const canStop = (session.presence === 'active' || session.presence === 'idle' || session.presence === 'suspended') && onStopSession;
  const canRestart = onRestartSession && issueId != null;
  const canDeepWipe = onDeepWipe && issueId != null;
  const hasLifecycleActions = canPause || canResume || canStop || canRestart;

  const handleDeepWipe = useCallback(() => {
    if (!issueId || !onDeepWipe) return;
    const confirmed = window.confirm(
      `Deep wipe will destroy all data for ${issueId} including workspace, state, and git branches. This cannot be undone.\n\nAre you absolutely sure?`,
    );
    if (confirmed) {
      onDeepWipe(issueId);
    }
    closeMenu();
  }, [issueId, onDeepWipe, closeMenu]);

  return (
    <>
      <button
        className={`${styles.sessionNode} ${isSelected ? styles.sessionNodeSelected : ''} ${flashClass}`}
        onClick={() => onClick?.()}
        onContextMenu={handleContextMenu}
      >
        {expandable && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onToggleExpand?.(); } }}
            style={{ display: 'inline-flex', flexShrink: 0, cursor: 'pointer' }}
          >
            {expanded
              ? <ChevronDown size={12} style={{ color: 'var(--muted-foreground)' }} />
              : <ChevronRight size={12} style={{ color: 'var(--muted-foreground)' }} />}
          </span>
        )}
        <StatusDot status={presenceToStatus(session.presence)} size="sm" />
        <TypeBadge type={session.type} role={session.role} />
        <span
          className={styles.sessionLabel}
          title={(() => {
            if (!lastActivity) return session.sessionId;
            const ms = Date.now() - new Date(lastActivity).getTime();
            if (ms < 60_000) return session.sessionId;
            return `${session.sessionId} · Last heard: ${formatLastHeard(ms)}`;
          })()}
        >
          {deriveSessionLabel(session)}
        </span>
        <LiveLastHeard lastActivity={lastActivity} />
        <span className={`${styles.sessionStatus} ${styles[`sessionStatus_${session.status}`] ?? ''}`}>
          {session.status}
        </span>
        <span className={styles.sessionDuration}>{formatDuration(session.duration)}</span>
      </button>

      {menu.open && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            zIndex: 1000,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            padding: '4px 0',
            minWidth: 160,
            fontSize: 12,
          }}
        >
          {/* Lifecycle actions */}
          {canPause && (
            <MenuItem
              label="Pause"
              onClick={() => {
                onPauseSession!(session.sessionId);
                closeMenu();
              }}
            />
          )}
          {canResume && (
            <MenuItem
              label="Resume"
              onClick={() => {
                onResumeSession!(session.sessionId);
                closeMenu();
              }}
            />
          )}
          {canStop && (
            <MenuItem
              label="Stop"
              onClick={() => {
                onStopSession!(session.sessionId);
                closeMenu();
              }}
            />
          )}
          {canRestart && (() => {
            const workTypeKey = session.type === 'review' ? 'specialist-review-agent'
              : session.type === 'reviewer' && session.role ? `review:${session.role}`
              : session.type === 'work' ? 'issue-agent:implementation'
              : session.type === 'planning' ? 'planning-agent'
              : session.type === 'test' ? 'specialist-test-agent'
              : session.type === 'merge' ? 'specialist-merge-agent'
              : null;
            const defaultModel = workTypeKey ? (resolvedModels[workTypeKey] ?? null) : null;
            const restartLabel = session.type === 'review' ? 'Restart all' : undefined;
            return (
              <RestartSubmenu
                defaultModel={defaultModel}
                groups={groups}
                label={restartLabel}
                onRestart={(model) => {
                  onRestartSession!(session.sessionId, issueId!, session.type, session.role, model);
                  closeMenu();
                }}
              />
            );
          })()}

          {hasLifecycleActions && canDeepWipe && <MenuDivider />}

          {/* Destructive */}
          {canDeepWipe && (
            <MenuItem label="Deep Wipe" variant="danger" onClick={handleDeepWipe} />
          )}

          {(hasLifecycleActions || canDeepWipe) && (onOpenStateDir || onViewJsonl) && <MenuDivider />}

          {/* Utility */}
          {onOpenStateDir && (
            <MenuItem
              label="Open State Dir"
              onClick={() => {
                onOpenStateDir(session.sessionId);
                closeMenu();
              }}
            />
          )}
          {onViewJsonl && session.hasJsonl && (
            <MenuItem
              label="View JSONL"
              onClick={() => {
                onViewJsonl(session.sessionId);
                closeMenu();
              }}
            />
          )}
          {onViewTerminal && (
            <MenuItem
              label="View Terminal"
              onClick={() => {
                onViewTerminal(session.sessionId);
                closeMenu();
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
