/**
 * IssueComposer — message composer for issue-selected mode in Zone C.
 *
 * Three states based on session presence:
 *   1. Active sessions exist → disabled with hint
 *   2. Zero sessions → enabled, "Spawn & Send" — sending spawns + routes
 *   3. All sessions ended → enabled, "Spawn Work & Send" — sending spawns + routes
 *
 * An inline notice explains the spawn behavior before the user clicks Send.
 */

import { useState, useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SendHorizontal, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionNode as SessionNodeType } from '@panopticon/contracts';
import type { StartAgentResponse } from '../../types';

interface IssueComposerProps {
  issueId: string;
  sessions: readonly SessionNodeType[];
}

type ComposerMode =
  | { kind: 'disabled'; hint: string }
  | { kind: 'spawn-and-send'; notice: string }
  | { kind: 'spawn-work-and-send'; notice: string };

function deriveComposerMode(sessions: readonly SessionNodeType[]): ComposerMode {
  const hasSessions = sessions.length > 0;
  const allEnded = hasSessions && sessions.every((s) => s.presence === 'ended');
  const hasActive = sessions.some((s) => s.presence === 'active' || s.presence === 'idle');

  if (hasActive) {
    return {
      kind: 'disabled',
      hint: 'Select an agent to chat, or use Spawn \u0026 Send below',
    };
  }

  if (allEnded) {
    return {
      kind: 'spawn-work-and-send',
      notice: 'All sessions ended — sending will spawn a fresh work agent and route your message',
    };
  }

  return {
    kind: 'spawn-and-send',
    notice: 'No sessions — sending will spawn a new work agent and route your message',
  };
}

export function IssueComposer({ issueId, sessions }: IssueComposerProps) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');

  const mode = useMemo(() => deriveComposerMode(sessions), [sessions]);
  const isEnabled = mode.kind !== 'disabled';

  const spawnMutation = useMutation({
    mutationFn: async (message: string) => {
      const requestBody = { issueId, message: message || undefined };
      let res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      let data = await res.json().catch(() => ({})) as StartAgentResponse;
      if (res.status === 409 && data.requiresAcknowledgement) {
        const confirmed = window.confirm((data.guardrails?.warnings ?? []).map((warning) => `• ${warning.message}`).join('\n'));
        if (!confirmed) throw new Error('Agent start canceled');
        res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...requestBody, guardrailAcknowledged: true }),
        });
        data = await res.json().catch(() => ({})) as StartAgentResponse;
      }
      if (!res.ok) {
        throw new Error(data.error || data.hint || 'Failed to start agent');
      }
      return data;
    },
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['agents'] }), 2000);
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 8000 });
    },
  });

  const handleSubmit = useCallback(() => {
    if (!isEnabled || !text.trim()) return;
    spawnMutation.mutate(text.trim());
  }, [isEnabled, text, spawnMutation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const isEmpty = text.trim() === '';
  const isSending = spawnMutation.isPending;

  return (
    <div
      data-testid="issue-composer"
      data-mode={mode.kind}
      style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--mc-border, var(--border))',
        background: 'var(--mc-surface-2, color-mix(in srgb, var(--foreground) 3%, transparent))',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flexShrink: 0,
      }}
    >
      {/* Inline notice for spawn modes */}
      {isEnabled && (
        <div
          data-testid="issue-composer-notice"
          style={{
            fontSize: 11,
            color: 'var(--mc-text-muted, var(--muted-foreground))',
            padding: '4px 8px',
            background: 'color-mix(in srgb, var(--primary) 6%, transparent)',
            borderRadius: 4,
            border: '1px solid color-mix(in srgb, var(--primary) 16%, transparent)',
          }}
        >
          {mode.notice}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <textarea
          data-testid="issue-composer-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isEnabled || isSending}
          placeholder={
            mode.kind === 'disabled'
              ? mode.hint
              : 'Type a message…'
          }
          rows={1}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid var(--mc-border, var(--border))',
            background: 'var(--mc-surface, var(--background))',
            color: 'var(--foreground)',
            fontSize: 13,
            lineHeight: 1.4,
            resize: 'none',
            outline: 'none',
            opacity: isEnabled ? 1 : 0.6,
            cursor: isEnabled ? 'text' : 'not-allowed',
            minHeight: 36,
            maxHeight: 120,
          }}
        />
        <button
          data-testid="issue-composer-send"
          onClick={handleSubmit}
          disabled={!isEnabled || isEmpty || isSending}
          title="Send message (Enter)"
          style={{
            padding: '8px 14px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--mc-primary, var(--primary))',
            color: 'var(--mc-primary-foreground, var(--primary-foreground))',
            fontSize: 13,
            fontWeight: 500,
            cursor: isEnabled && !isEmpty && !isSending ? 'pointer' : 'not-allowed',
            opacity: isEnabled && !isEmpty && !isSending ? 1 : 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
          }}
        >
          {isSending ? (
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <SendHorizontal size={14} />
          )}
          {mode.kind === 'spawn-work-and-send'
            ? 'Spawn Work \u0026 Send'
            : mode.kind === 'spawn-and-send'
              ? 'Spawn \u0026 Send'
              : 'Send'}
        </button>
      </div>
    </div>
  );
}
