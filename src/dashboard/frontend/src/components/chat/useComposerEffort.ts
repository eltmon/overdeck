/**
 * Composer effort state (PAN-4255): the picker value, the `<Level> · <source>`
 * chip for a running session, and live changes.
 *
 * A live change POSTs `{ level }` to `/api/agents/:id/effort` for an
 * agent-backed panel, else to `/api/conversations/:name/thinking-level`.
 * Claude Code applies it with `/effort` and the server answers only after the
 * transcript confirms it, so the chip shows `Applying…` until then.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { isEffortLevel, type EffortSource } from '@overdeck/contracts';
import type { Conversation } from '../CommandDeck/ConversationList';
import { fetchEffortDefault } from '../newConversation/newConversationApi';
import { loadStoredEffort, type EffortLevel } from './EffortPicker';
import { effortChipTitle, resolveEffortChip, type EffortChip } from './effortChip';

export interface EffortResolution {
  effort: string;
  source: EffortSource;
}

export interface UseComposerEffortInput {
  conversation: Conversation;
  agentId?: string;
  harness: string;
  model: string;
  piConversation: boolean;
  /** Effort read from the session transcript (`ContextUsage.lastEffort` or the agent read's `observedEffort`). */
  observedEffort?: string | null;
  /** The agent's launch/pinned effort and its source (agent-backed panels only). */
  effortResolution?: EffortResolution | null;
}

export interface ComposerEffort {
  effort: EffortLevel;
  chip: EffortChip | null;
  pending: boolean;
  liveChangeEnabled: boolean;
  title: string;
  onChange: (level: EffortLevel) => void;
}

/** kimi-code and ACP expose fewer tiers; show the tier they actually run. */
function mapForHarness(harness: Conversation['harness'], effort: string): string {
  if (harness === 'kimi-code' || harness === 'acp') {
    if (effort === 'medium') return 'high';
    if (effort === 'xhigh') return 'max';
  }
  return effort;
}

/** The conversation's stored effort as a canonical level, or null when unset/invalid. */
function storedConversationEffort(conversation: Conversation): EffortLevel | null {
  if (!conversation.effort) return null;
  const mapped = mapForHarness(conversation.harness, conversation.effort);
  const stored = mapped === 'off' || mapped === 'minimal' ? 'low' : mapped;
  return isEffortLevel(stored) ? stored : null;
}

export function resolveComposerEffort(conversation: Conversation): EffortLevel {
  const stored = storedConversationEffort(conversation);
  if (stored) return stored;
  // The browser-global value is a draft default, not canonical session state.
  // Only use it before a runtime session exists; older conversations whose
  // effort was never persisted use the operator default instead.
  return !conversation.sessionAlive && !conversation.claudeSessionId ? loadStoredEffort() : 'high';
}

function supportsLiveChange(harness: string, piConversation: boolean, agentId: string | undefined): boolean {
  if (agentId) return harness === 'claude-code';
  return harness === 'claude-code' || piConversation || harness === 'codex' || harness === 'acp' || harness === 'opencode';
}

export function useComposerEffort({
  conversation,
  agentId,
  harness,
  model,
  piConversation,
  observedEffort = null,
  effortResolution = null,
}: UseComposerEffortInput): ComposerEffort {
  const resolvedConversationEffort = resolveComposerEffort(conversation);
  const [effort, setEffort] = useState<EffortLevel>(resolvedConversationEffort);
  const [pending, setPending] = useState(false);
  // A confirmed live change wins over the props until the panel shows another conversation.
  // `staleObserved` is the transcript level at confirmation time; it lags the
  // change, so it is ignored until the transcript reports a new value.
  const [override, setOverride] = useState<{ name: string; resolution: EffortResolution; staleObserved: string | null } | null>(null);
  const [defaultResolution, setDefaultResolution] = useState<EffortResolution | null>(null);
  const currentNameRef = useRef(conversation.name);
  currentNameRef.current = conversation.name;

  useEffect(() => {
    setEffort(resolvedConversationEffort);
  }, [conversation.name, conversation.effort, resolvedConversationEffort]);

  const hasSession = Boolean(conversation.sessionAlive || conversation.claudeSessionId || agentId);
  const storedEffort = storedConversationEffort(conversation);
  const needsDefault = !agentId && !storedEffort && Boolean(conversation.sessionAlive || conversation.claudeSessionId);
  const issueId = conversation.issueId;

  // No stored effort: the launcher resolved it through the default chain, so ask the same chain.
  useEffect(() => {
    if (!needsDefault) {
      setDefaultResolution(null);
      return;
    }
    let cancelled = false;
    fetchEffortDefault({ model, harness, issueId })
      .then((resolved) => {
        if (!cancelled) setDefaultResolution({ effort: resolved.effort, source: resolved.source });
      })
      .catch(() => {
        if (!cancelled) setDefaultResolution(null);
      });
    return () => { cancelled = true; };
  }, [needsDefault, model, harness, issueId]);

  const liveChangeEnabled = conversation.sessionAlive && supportsLiveChange(harness, piConversation, agentId);
  const localOverride = override?.name === conversation.name ? override : null;
  const resolved: EffortResolution | null = localOverride?.resolution
    ?? (agentId ? effortResolution : storedEffort ? { effort: storedEffort, source: 'explicit' } : defaultResolution);
  const observedLags = localOverride !== null
    && localOverride.staleObserved !== localOverride.resolution.effort
    && observedEffort === localOverride.staleObserved;
  const observed = observedLags ? null : observedEffort;
  const chip = hasSession ? resolveEffortChip({ resolved, observed }) : null;
  const title = chip
    ? effortChipTitle(chip, { liveChangeEnabled, harness })
    : supportsLiveChange(harness, piConversation, agentId)
      ? 'Changes apply to subsequent turns after runtime acceptance.'
      : 'Change effort in the native terminal for this session.';

  const onChange = useCallback((nextEffort: EffortLevel) => {
    const previousEffort = effort;
    setEffort(nextEffort);
    if (!liveChangeEnabled) return;
    const name = conversation.name;
    const url = agentId
      ? `/api/agents/${encodeURIComponent(agentId)}/effort`
      : `/api/conversations/${encodeURIComponent(name)}/thinking-level`;
    setPending(true);
    void (async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: nextEffort }),
      });
      const body = await res.json().catch(() => null) as { effort?: string; error?: string } | null;
      if (currentNameRef.current !== name) return;
      if (!res.ok) {
        setEffort(previousEffort);
        toast.error(body?.error ?? `Failed to change effort (${res.status})`);
        return;
      }
      const acknowledged = mapForHarness(conversation.harness, body?.effort ?? nextEffort);
      const confirmed = isEffortLevel(acknowledged) ? acknowledged : nextEffort;
      setEffort(confirmed);
      setOverride({ name, resolution: { effort: confirmed, source: 'explicit' }, staleObserved: observedEffort });
    })().catch((err: unknown) => {
      if (currentNameRef.current !== name) return;
      setEffort(previousEffort);
      toast.error(err instanceof Error ? err.message : 'Failed to change effort');
    }).finally(() => {
      setPending(false);
    });
  }, [agentId, conversation.harness, conversation.name, effort, liveChangeEnabled, observedEffort]);

  return { effort, chip, pending, liveChangeEnabled, title, onChange };
}
