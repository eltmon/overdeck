/**
 * In-memory, mtime-keyed store for turn-end assessments (PAN-4371).
 *
 * The enrichment poll is synchronous and must never wait on a transcript read
 * or a Jev call: `scheduleTurnEndAssessment` fires an async run and returns
 * immediately, and the poll reads back whatever is ready via `peekTurnEndAssessment`
 * on a later tick. Nothing here is persisted — a restart clears the store.
 */
import { loadConfigSync } from '../config-yaml.js';
import { getAgentWorkspace } from '../agent-enrichment.js';
import { readLastAssistantMessage as defaultReadLastAssistantMessage } from '../agents/last-assistant-message.js';
import { resolveJevForFeature } from './config.js';
import { assessTurnEnd as defaultAssessTurnEnd, toTurnEndView, type TurnEndAssessment } from './turn-end.js';

export const TURN_END_STORE_MAX_ENTRIES = 256;

interface TurnEndStoreEntry {
  mtime: number;
  messageId?: string;
  view?: TurnEndAssessment;
  reason?: string;
}

export interface TurnEndStoreDeps {
  isEnabled?: () => boolean;
  resolveWorkspace?: (agentId: string) => Promise<string | null>;
  readLastAssistantMessage?: typeof defaultReadLastAssistantMessage;
  assessTurnEnd?: typeof defaultAssessTurnEnd;
}

let store = new Map<string, TurnEndStoreEntry>();
const inFlight = new Set<string>();

export function isTurnEndAssessmentEnabled(): boolean {
  return resolveJevForFeature('jevTurnEndAssessment', loadConfigSync().config).ok;
}

/** Synchronous, non-blocking: the enrichment poll never waits on this. */
export function peekTurnEndAssessment(agentId: string, transcriptMtime: number | null): TurnEndAssessment | undefined {
  if (!isTurnEndAssessmentEnabled() || transcriptMtime === null) return undefined;
  const entry = store.get(agentId);
  if (!entry || entry.mtime !== transcriptMtime) return undefined;
  return entry.view;
}

/** Fire-and-forget: always returns synchronously. Rejections are swallowed. */
export function scheduleTurnEndAssessment(
  input: { agentId: string; role: string; transcriptMtime: number | null },
  deps: TurnEndStoreDeps = {},
): void {
  const isEnabled = deps.isEnabled ?? isTurnEndAssessmentEnabled;
  if (!isEnabled()) return;
  const { agentId, role, transcriptMtime } = input;
  if (transcriptMtime === null) return;

  const existing = store.get(agentId);
  if (existing && existing.mtime === transcriptMtime) return;

  const inFlightKey = `${agentId}:${transcriptMtime}`;
  if (inFlight.has(inFlightKey)) return;
  inFlight.add(inFlightKey);

  const resolveWorkspace = deps.resolveWorkspace ?? getAgentWorkspace;
  const readLastAssistantMessage = deps.readLastAssistantMessage ?? defaultReadLastAssistantMessage;
  const assessTurnEnd = deps.assessTurnEnd ?? defaultAssessTurnEnd;

  void (async () => {
    const workspace = await resolveWorkspace(agentId);
    if (!workspace) {
      setEntry(agentId, { mtime: transcriptMtime, view: undefined, reason: 'no-transcript' });
      return;
    }
    const message = await readLastAssistantMessage(agentId, workspace);
    if (!message.ok) {
      setEntry(agentId, { mtime: transcriptMtime, view: undefined, reason: message.reason });
      return;
    }
    const outcome = await assessTurnEnd({
      agentId,
      role,
      harness: message.transcriptKind,
      lastAssistantText: message.text,
      messageId: message.messageId,
    });
    setEntry(agentId, { mtime: transcriptMtime, messageId: message.messageId, view: toTurnEndView(outcome) });
  })()
    .catch(() => {})
    .finally(() => {
      inFlight.delete(inFlightKey);
    });
}

export function clearTurnEndAssessment(agentId: string): void {
  store.delete(agentId);
}

export function resetTurnEndStore(): void {
  store = new Map();
  inFlight.clear();
}

function setEntry(agentId: string, entry: TurnEndStoreEntry): void {
  if (!store.has(agentId) && store.size >= TURN_END_STORE_MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(agentId, entry);
}
