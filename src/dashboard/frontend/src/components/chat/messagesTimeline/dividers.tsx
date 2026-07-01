import { useEffect, useState } from 'react';
import { RotateCcw, Scissors, ShieldCheck, Wrench } from 'lucide-react';
import type { WorkingPhase } from '../../../lib/workingPhase';
import type { ChatMessage, CompactBoundary } from '../chat-types';
import type { RoundVerdict } from '../../CommandDeck/RoundCard';
import styles from '../../CommandDeck/styles/command-deck.module.css';
import { formatTimestamp } from './helpers';
import type { RoundMarker } from './types';

export function WorkingIndicator({ startedAt, phase }: { startedAt: string | null; phase?: WorkingPhase }) {
  const [elapsed, setElapsed] = useState(0);
  const startMs = startedAt ? new Date(startedAt).getTime() : Date.now();

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startMs) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startMs]);

  const isToolPhase = phase === 'tool';

  return (
    <div className={styles.workingIndicator}>
      {isToolPhase ? (
        <Wrench size={14} className={styles.pulseIcon} aria-label="Using tool" />
      ) : (
        <span className={styles.workingDots}>
          <span />
          <span />
          <span />
        </span>
      )}
      <span className={styles.workingLabel}>
        Working{elapsed > 0 ? ` for ${elapsed}s` : '…'}
      </span>
    </div>
  );
}

const ROUND_VERDICT_COLOR: Record<RoundVerdict, string> = {
  pending: 'var(--muted-foreground)',
  passed: 'var(--success)',
  failed: 'var(--destructive)',
  running: 'var(--primary)',
};

const ROUND_VERDICT_LABEL: Record<RoundVerdict, string> = {
  pending: 'Pending',
  passed: 'Passed',
  failed: 'Failed',
  running: 'Running',
};

export function RoundDivider({ marker }: { marker: RoundMarker }) {
  const color = ROUND_VERDICT_COLOR[marker.verdict];
  const verdictLabel = ROUND_VERDICT_LABEL[marker.verdict];
  return (
    <div
      data-testid={`round-divider-${marker.round}`}
      data-round={marker.round}
      data-verdict={marker.verdict}
      role="separator"
      aria-label={`Round ${marker.round} — ${verdictLabel}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: '12px 0',
        width: '100%',
      }}
    >
      <div
        style={{
          flex: 1,
          height: 1,
          background: 'var(--border)',
        }}
      />
      <span
        style={{
          padding: '2px 10px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color,
          border: `1px solid ${color}`,
          background: 'var(--card, var(--background))',
          whiteSpace: 'nowrap',
        }}
      >
        Round {marker.round} · {verdictLabel}
        {marker.label ? ` · ${marker.label}` : ''}
      </span>
      <div
        style={{
          flex: 1,
          height: 1,
          background: 'var(--border)',
        }}
      />
    </div>
  );
}

export function SessionPermissionsRow({ message }: { message: ChatMessage }) {
  return (
    <div className={styles.sessionPermissionsRow}>
      <ShieldCheck size={11} className={styles.sessionPermissionsIcon} />
      <span className={styles.sessionPermissionsLabel}>Permissions:</span>
      <span className={styles.sessionPermissionsTools}>{message.text}</span>
    </div>
  );
}

/**
 * Renders a Claude Code slash command (the kind Claude Code emits as a user
 * message wrapped in `<command-name>X</command-name>`) as a horizontal divider
 * instead of a regular message bubble. Most relevant for `/clear`, which
 * signals the JSONL boundary — see PAN-1458 — but applies to any slash command
 * Claude Code happens to record this way.
 */
export function SlashCommandDivider({ command, createdAt }: { command: string; createdAt: string }) {
  const isClear = command === '/clear';
  const label = isClear ? 'Conversation cleared' : `Slash command: ${command}`;
  return (
    <div className={styles.compactBoundaryDivider}>
      <div className={styles.compactBoundaryLine} />
      <div className={styles.compactBoundaryLabel}>
        <RotateCcw size={12} />
        <span>{label}</span>
        <span className={styles.compactBoundaryDetail}>{formatTimestamp(createdAt)}</span>
      </div>
      <div className={styles.compactBoundaryLine} />
    </div>
  );
}

export function CompactBoundaryDivider({ boundary }: { boundary: CompactBoundary }) {
  const label = boundary.preTokens
    ? `Compacted (${Math.round(boundary.preTokens / 1000)}k tokens)`
    : 'Conversation compacted';
  const detail = [
    boundary.trigger && boundary.trigger !== 'overdeck-native' ? boundary.trigger : null,
    boundary.model,
  ].filter(Boolean).join(' · ');

  return (
    <div className={styles.compactBoundaryDivider}>
      <div className={styles.compactBoundaryLine} />
      <div className={styles.compactBoundaryLabel}>
        <Scissors size={12} />
        <span>{label}</span>
        {detail && <span className={styles.compactBoundaryDetail}>{detail}</span>}
      </div>
      <div className={styles.compactBoundaryLine} />
    </div>
  );
}

export function CompactingIndicator() {
  return (
    <div className={styles.compactingIndicator}>
      <Scissors size={14} className={styles.compactingIcon} />
      <span>Compacting conversation...</span>
    </div>
  );
}
