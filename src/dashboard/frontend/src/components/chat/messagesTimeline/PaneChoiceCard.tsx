/**
 * PaneChoiceCard — PAN-3113, the actionable rendering of a blocking
 * numbered-choice menu parsed from the conversation's pane (session-resume
 * gate et al.). Design: docs/design/conversation-choice-prompt-mockup-a-inline-card.html
 * (operator-approved mockup A).
 *
 * High-confidence parses render as a native decision card (radio rows,
 * recommended pre-flagged, Send answer). Low-confidence parses render the
 * verbatim menu block with clickable rows — the answer still goes through
 * the signature-checked endpoint, so a slightly-off parse cannot send
 * keystrokes into a different prompt.
 *
 * Answering flips the card to the emerald "Answered" outcome state and the
 * parent records it, so the timeline keeps an answered row after the
 * pending-input feed stops reporting the menu.
 */
import { memo, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Terminal as TerminalIcon } from 'lucide-react';
import {
  answerConversationPaneChoice,
  type AnsweredPaneChoice,
  type PendingPaneChoice,
} from '../../../lib/paneChoice';

const MONO = 'var(--font-mono, ui-monospace, "SF Mono", Menlo, monospace)';

const styles = {
  card: (answered: boolean) => ({
    margin: '12px 0 8px',
    border: '1px solid var(--border)',
    borderLeft: `3px solid ${answered ? 'var(--success)' : 'var(--warning)'}`,
    borderRadius: 8,
    background: 'var(--card)',
    color: 'var(--foreground)',
    fontSize: 14,
    overflow: 'hidden' as const,
  }),
  badge: (tone: 'warning' | 'success') => ({
    display: 'inline-flex',
    alignItems: 'center',
    height: 20,
    padding: '0 8px',
    borderRadius: 6,
    fontSize: 11.5,
    fontWeight: 500,
    flex: 'none' as const,
    background: `color-mix(in srgb, var(--${tone}) 8%, transparent)`,
    border: `1px solid color-mix(in srgb, var(--${tone}) 32%, transparent)`,
    color: `var(--${tone}-foreground)`,
  }),
} as const;

interface PaneChoiceCardProps {
  choice: PendingPaneChoice;
  conversationName?: string;
  onOpenTerminal?: () => void;
  onAnswered?: (signature: string, label: string) => void;
}

export const PaneChoiceCard = memo(function PaneChoiceCard({
  choice,
  conversationName,
  onOpenTerminal,
  onAnswered,
}: PaneChoiceCardProps) {
  const [selected, setSelected] = useState(choice.selectedIndex);
  const [phase, setPhase] = useState<'idle' | 'sending' | 'answered' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [answeredLabel, setAnsweredLabel] = useState('');
  const queryClient = useQueryClient();

  const send = useCallback(async (index: number) => {
    if (!conversationName || phase === 'sending' || phase === 'answered') return;
    setPhase('sending');
    setError(null);
    const result = await answerConversationPaneChoice(conversationName, index, choice.signature);
    if (result.ok) {
      const label = result.answeredLabel || choice.options[index]?.label || '';
      setAnsweredLabel(label);
      setPhase('answered');
      onAnswered?.(choice.signature, label);
    } else {
      setError(result.error);
      setPhase('error');
    }
    // Either way the feed's view of the menu is now stale — refetch so a
    // vanished menu clears the card and a changed menu re-renders fresh.
    void queryClient.invalidateQueries({ queryKey: ['conv-ask-user-question'] });
  }, [choice, conversationName, phase, onAnswered, queryClient]);

  if (phase === 'answered') {
    return <PaneChoiceAnsweredRow answered={{ signature: choice.signature, label: answeredLabel, at: '' }} />;
  }

  const busy = phase === 'sending';

  return (
    <div style={styles.card(false)} data-component="pane-choice-card" data-confidence={choice.confidence}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 0' }}>
        <span style={styles.badge('warning')}>Needs you</span>
        <span style={{ fontSize: 14.5 }}>{choice.title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>
          from the agent's pane
        </span>
      </div>

      {choice.contextLines.length > 1 && (
        <div style={{ padding: '6px 16px 0', color: 'var(--muted-foreground)', fontSize: 13.5 }}>
          {choice.contextLines.slice(1).map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {choice.confidence === 'high' ? (
        <div style={{ padding: '10px 12px 4px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {choice.options.map((option, index) => {
            const isSelected = index === selected;
            return (
              <button
                key={option.number}
                type="button"
                disabled={busy}
                onClick={() => setSelected(index)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  border: `1px solid ${isSelected ? 'color-mix(in srgb, var(--primary) 45%, transparent)' : 'var(--border)'}`,
                  background: isSelected ? 'color-mix(in srgb, var(--primary) 4%, transparent)' : 'transparent',
                  borderRadius: 8,
                  padding: '8px 12px',
                  cursor: busy ? 'default' : 'pointer',
                  font: 'inherit',
                  fontSize: 13.5,
                  color: 'inherit',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--muted-foreground)', flex: 'none' }}>
                  {option.number}
                </span>
                <span
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: '50%',
                    flex: 'none',
                    border: `1.5px solid ${isSelected ? 'var(--primary)' : 'var(--muted-foreground)'}`,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  {isSelected && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary)' }} />}
                </span>
                <span>{option.label}</span>
                {option.recommended && (
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--muted-foreground)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '0 6px',
                      height: 18,
                      display: 'inline-flex',
                      alignItems: 'center',
                      marginLeft: 8,
                      flex: 'none',
                    }}
                  >
                    Recommended
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        // Low-confidence parse — verbatim mirror of the pane menu. Clicking a
        // row answers it directly; the server still verifies the signature.
        <div style={{ padding: '10px 16px 4px' }}>
          <div
            style={{
              background: 'var(--muted)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontFamily: MONO,
              fontSize: 12.5,
              lineHeight: 1.55,
              padding: '10px 12px',
            }}
          >
            {choice.options.map((option, index) => {
              const hasCursor = index === choice.selectedIndex;
              return (
                <div
                  key={option.number}
                  role="button"
                  tabIndex={0}
                  onClick={() => { if (!busy) void send(index); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void send(index); }}
                  style={{
                    display: 'flex',
                    gap: 8,
                    padding: '1px 6px',
                    margin: '0 -6px',
                    borderRadius: 6,
                    cursor: busy ? 'default' : 'pointer',
                    background: hasCursor ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'transparent',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  <span style={{ color: 'var(--muted-foreground)', visibility: hasCursor ? 'visible' : 'hidden' }}>❯</span>
                  <span>
                    {option.number}. {option.label}
                    {option.recommended ? ' (recommended)' : ''}
                  </span>
                </div>
              );
            })}
            {choice.footerHint && (
              <div style={{ color: 'var(--muted-foreground)', marginTop: 8 }}>{choice.footerHint}</div>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted-foreground)', marginTop: 6 }}>
            Mirrored verbatim from the pane — click a row to answer it.
          </div>
        </div>
      )}

      {phase === 'error' && error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px 0', color: 'var(--destructive)', fontSize: 12.5 }}>
          <AlertTriangle size={13} style={{ flex: 'none' }} />
          <span>{error}</span>
        </div>
      )}

      {choice.confidence === 'high' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px 14px' }}>
          <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
            Answering sends the choice to the agent's pane — no terminal needed.
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {onOpenTerminal && (
              <button
                type="button"
                onClick={onOpenTerminal}
                disabled={busy}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  font: 'inherit',
                  fontSize: 13.5,
                  borderRadius: 8,
                  padding: '6px 14px',
                  cursor: 'pointer',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                }}
              >
                <TerminalIcon size={13} />
                Open terminal
              </button>
            )}
            <button
              type="button"
              onClick={() => void send(selected)}
              disabled={busy}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                font: 'inherit',
                fontSize: 13.5,
                borderRadius: 8,
                padding: '6px 14px',
                cursor: busy ? 'default' : 'pointer',
                background: 'var(--primary)',
                border: '1px solid transparent',
                color: 'var(--primary-foreground)',
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'Sending…' : 'Send answer'}
            </button>
          </span>
        </div>
      )}
      {choice.confidence !== 'high' && onOpenTerminal && (
        <div style={{ display: 'flex', padding: '6px 16px 12px' }}>
          <button
            type="button"
            onClick={onOpenTerminal}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              font: 'inherit',
              fontSize: 12.5,
              borderRadius: 8,
              padding: '4px 10px',
              cursor: 'pointer',
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
              marginLeft: 'auto',
            }}
          >
            <TerminalIcon size={13} />
            Open terminal
          </button>
        </div>
      )}
    </div>
  );
});

/** Emerald outcome row shown after a choice is answered from the dashboard. */
export const PaneChoiceAnsweredRow = memo(function PaneChoiceAnsweredRow({ answered }: { answered: AnsweredPaneChoice }) {
  return (
    <div style={styles.card(true)} data-component="pane-choice-answered">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
        <span style={styles.badge('success')}>Answered</span>
        <Check size={14} style={{ color: 'var(--success-foreground)', flex: 'none' }} />
        <span style={{ fontSize: 13.5 }}>
          You answered: <span style={{ fontFamily: MONO, fontSize: 12.5 }}>{answered.label}</span>
          {' '}— sent to the agent's pane
        </span>
      </div>
    </div>
  );
});
