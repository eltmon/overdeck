import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, Terminal } from 'lucide-react';
import type { ChatMessage } from '../chat-types';

interface CommandResultRowProps {
  message: ChatMessage;
  onConfirm?: (messageId: string, typedText?: string) => Promise<void>;
}

function statusSentence(message: ChatMessage): string {
  const result = message.commandResult;
  if (!result) return 'The command did not return a structured result.';
  switch (result.kind) {
    case 'captured':
      return result.status === 'completed'
        ? `${result.command} completed successfully.`
        : `${result.command} failed.`;
    case 'activity':
      return `${result.command} was accepted and is running in the background.`;
    case 'confirmation':
      return 'Confirmation is required before this command can run.';
    case 'terminal-only':
      return 'This command was rejected because it can only run in a terminal.';
    case 'ui':
      return 'This command requires a dashboard dialog.';
  }
}

export function CommandResultRow({ message, onConfirm }: CommandResultRowProps) {
  const result = message.commandResult;
  const [typedText, setTypedText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  if (!result) return null;

  const failed = result.kind === 'captured' && result.status === 'failed';
  const rejected = result.kind === 'terminal-only';
  const needsConfirmation = result.kind === 'confirmation';
  const Icon = failed || rejected ? AlertTriangle : needsConfirmation ? ShieldCheck :
    result.kind === 'activity' ? Terminal : CheckCircle2;

  const handleConfirm = async () => {
    if (!onConfirm || result.kind !== 'confirmation') return;
    setConfirming(true);
    setConfirmationError(null);
    try {
      await onConfirm(message.id, result.typedText ? typedText : undefined);
    } catch (error) {
      setConfirmationError(error instanceof Error ? error.message : 'The command could not be confirmed.');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div
      data-command-result={result.status}
      style={{
        margin: '8px 0',
        padding: '10px 12px',
        border: `1px solid ${failed || rejected ? 'var(--destructive)' : 'var(--border)'}`,
        borderRadius: 8,
        background: 'var(--muted)',
        color: 'var(--foreground)',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Icon
          size={14}
          style={{
            flexShrink: 0,
            marginTop: 1,
            color: failed || rejected ? 'var(--destructive)' : 'var(--muted-foreground)',
          }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{statusSentence(message)}</div>

          {result.kind === 'activity' && (
            <>
              <div style={{ marginTop: 4, color: 'var(--muted-foreground)' }}>{result.message}</div>
              <div style={{ marginTop: 4, fontFamily: 'monospace' }}>Activity: {result.activityId}</div>
            </>
          )}

          {result.kind === 'captured' && result.output && (
            <pre
              style={{
                margin: '8px 0 0',
                padding: 8,
                maxHeight: 280,
                overflow: 'auto',
                borderRadius: 6,
                background: 'var(--background)',
                border: '1px solid var(--border)',
                fontFamily: 'monospace',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {result.output}
            </pre>
          )}
          {result.kind === 'captured' && result.truncated && (
            <div style={{ marginTop: 6, color: 'var(--warning)' }}>
              The captured output was truncated at the server limit.
            </div>
          )}

          {result.kind === 'terminal-only' && (
            <div style={{ marginTop: 4, color: 'var(--muted-foreground)' }}>{result.message}</div>
          )}

          {result.kind === 'confirmation' && (
            <div style={{ marginTop: 6 }}>
              <div style={{ color: 'var(--muted-foreground)' }}>{result.consequence}</div>
              {result.typedText && (
                <label style={{ display: 'block', marginTop: 8 }}>
                  <span style={{ display: 'block', marginBottom: 4 }}>
                    Type <code>{result.typedText}</code> to confirm.
                  </span>
                  <input
                    aria-label={`Type ${result.typedText} to confirm`}
                    value={typedText}
                    onChange={(event) => setTypedText(event.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '6px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      background: 'var(--background)',
                      color: 'var(--foreground)',
                      fontFamily: 'monospace',
                    }}
                  />
                </label>
              )}
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={confirming || Boolean(result.typedText && typedText !== result.typedText)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 8,
                  padding: '5px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  background: 'var(--background)',
                  color: 'var(--foreground)',
                  cursor: confirming ? 'wait' : 'pointer',
                }}
              >
                {confirming && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                {confirming ? 'Confirming…' : 'Confirm command'}
              </button>
              {confirmationError && (
                <div role="alert" style={{ marginTop: 6, color: 'var(--destructive)' }}>
                  {confirmationError} Submit the command again to request a new confirmation.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
