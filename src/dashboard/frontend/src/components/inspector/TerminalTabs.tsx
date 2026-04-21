import { Pin, PinOff, Loader2 } from 'lucide-react';

export type PipelinePhase =
  | 'planning'
  | 'working'
  | 'reviewing'
  | 'review-feedback'
  | 'testing'
  | 'merging'
  | 'merged';

export interface TerminalTab {
  /** Phase or role identifier */
  id: PipelinePhase | string;
  /** Human-readable label */
  label: string;
  /** tmux session name — null means show summary card */
  sessionName: string | null;
  /** Whether this tab should be auto-selected for the current phase */
  isActive: boolean;
  /** Disabled when the session doesn't exist yet */
  disabled: boolean;
  /** Show a spinner when the underlying agent is actively processing */
  isRunning?: boolean;
}

interface TerminalTabsProps {
  tabs: TerminalTab[];
  /** The session name currently being displayed */
  selectedSession: string | null;
  /** Current auto-derived phase label (shown in the phase chip) */
  activePhase: PipelinePhase | string;
  /** True when the user has manually pinned a session */
  pinned: boolean;
  onSelectSession: (sessionName: string | null) => void;
  onTogglePin: () => void;
}

export const PHASE_CHIP_COLORS: Record<string, { bg: string; text: string }> = {
  planning:          { bg: '#1e3a5f', text: '#60a5fa' },
  working:           { bg: '#1a3a1a', text: '#4ade80' },
  reviewing:         { bg: '#2d1a3a', text: '#c084fc' },
  'review-feedback': { bg: '#3a1a1a', text: '#f87171' },
  testing:           { bg: '#1a2d3a', text: '#38bdf8' },
  merging:           { bg: '#2d2014', text: '#fb923c' },
  merged:            { bg: '#1a3a2d', text: '#34d399' },
};

export const PHASE_LABELS: Record<string, string> = {
  planning:          'Planning',
  working:           'Working',
  reviewing:         'Reviewing',
  'review-feedback': 'Review Feedback',
  testing:           'Testing',
  merging:           'Merging',
  merged:            'Merged',
};

const borderColor = '#232f48';
const bgHeader = '#161b26';
const textSecondary = '#92a4c9';
const textMuted = '#4a5568';
const bgActive = '#1e2d47';
const bgHover = '#1a2236';

export function loadPinState(issueId: string): string | null {
  try {
    return localStorage.getItem(`pan-terminal-pin-${issueId}`);
  } catch {
    return null;
  }
}

export function savePinState(issueId: string, sessionName: string | null): void {
  try {
    const key = `pan-terminal-pin-${issueId}`;
    if (sessionName === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, sessionName);
    }
  } catch {
    // ignore storage errors
  }
}

export function TerminalTabs({
  tabs,
  selectedSession,
  activePhase,
  pinned,
  onSelectSession,
  onTogglePin,
}: TerminalTabsProps) {
  const phaseColors = PHASE_CHIP_COLORS[activePhase] ?? { bg: '#1e2d47', text: textSecondary };
  const phaseLabel = PHASE_LABELS[activePhase] ?? activePhase;

  return (
    <div
      className="flex items-center gap-1 px-2 border-b shrink-0 select-none"
      style={{ borderColor, backgroundColor: bgHeader, height: '32px' }}
    >
      {/* Phase chip */}
      <span
        className="text-xs font-semibold px-1.5 py-0.5 rounded mr-1"
        style={{ backgroundColor: phaseColors.bg, color: phaseColors.text, fontSize: '10px' }}
      >
        {phaseLabel}
      </span>

      {/* Tab buttons */}
      <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto">
        {tabs.map(tab => {
          const isSelected = tab.sessionName === selectedSession;
          return (
            <button
              key={tab.id}
              disabled={tab.disabled}
              onClick={() => {
                if (!tab.disabled) {
                  onSelectSession(tab.sessionName);
                  // If user clicks a different tab than auto, engage pin
                  if (!tab.isActive && !pinned) {
                    onTogglePin();
                  }
                }
              }}
              title={tab.disabled ? 'Session not available' : tab.label}
              className="text-xs px-2 py-0.5 rounded transition-colors whitespace-nowrap"
              style={{
                color: tab.disabled
                  ? textMuted
                  : isSelected
                    ? '#e2e8f0'
                    : textSecondary,
                backgroundColor: isSelected ? bgActive : 'transparent',
                cursor: tab.disabled ? 'default' : 'pointer',
                fontWeight: tab.isActive ? 600 : 400,
                fontSize: '11px',
              }}
              onMouseEnter={e => {
                if (!tab.disabled && !isSelected) {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = bgHover;
                }
              }}
              onMouseLeave={e => {
                if (!isSelected) {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                }
              }}
            >
              {tab.label}
              {tab.isRunning && (
                <Loader2
                  className="ml-1 inline-block animate-spin"
                  style={{ width: '10px', height: '10px', verticalAlign: 'middle' }}
                />
              )}
              {tab.isActive && !tab.isRunning && (
                <span
                  className="ml-1 inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: phaseColors.text, verticalAlign: 'middle' }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Auto / Pin toggle */}
      <button
        onClick={onTogglePin}
        title={pinned ? 'Pinned — click to follow phase automatically' : 'Auto-following phase — click to pin current session'}
        className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded transition-colors ml-1 shrink-0"
        style={{
          color: pinned ? '#fbbf24' : textMuted,
          backgroundColor: 'transparent',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = bgHover;
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
        }}
      >
        {pinned ? (
          <Pin className="w-3 h-3" />
        ) : (
          <PinOff className="w-3 h-3" />
        )}
        <span style={{ fontSize: '10px' }}>{pinned ? 'Pinned' : 'Auto'}</span>
      </button>
    </div>
  );
}
