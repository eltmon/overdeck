/**
 * PAN-5465 WI-8 (FR-11): the Add skills… dialog. It preselects the
 * conversation's current skill map (GET /api/conversations/:name/skills),
 * reuses the New conversation dialog's skill list, and posts only the changed
 * ids to POST /api/conversations/:name/skills. A needs-restart answer offers
 * Restart and load, which re-posts the same body with restart: true.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../shared/Modal';
import formStyles from '../shared/ModalForm.module.css';
import { ConversationSkillsField } from '../newConversation/ConversationSkillsField';
import type { Conversation } from './ConversationList';

export type SkillApplyOutcome = 'hot' | 'sent' | 'queued' | 'needs-restart' | 'restarted' | 'next-launch';

interface ConversationSkillsResponse {
  conversation: string;
  harness: string;
  running: boolean;
  skillOverrides: Record<string, boolean>;
}

interface SkillApplyResult {
  outcome: SkillApplyOutcome;
  added: string[];
  warnings: string[];
}

export interface SkillChangeBody {
  skills?: string[];
  off?: string[];
}

/** D-1 is add-only: newly On ids go in `skills`, newly Off ids in `off`; an id cleared back to Inherit is not sent. */
export function skillChangeBody(loaded: Record<string, boolean>, next: Record<string, boolean>): SkillChangeBody {
  const skills = Object.keys(next).filter((id) => next[id] === true && loaded[id] !== true).sort();
  const off = Object.keys(next).filter((id) => next[id] === false && loaded[id] !== false).sort();
  return { ...(skills.length > 0 ? { skills } : {}), ...(off.length > 0 ? { off } : {}) };
}

function countSkills(n: number): string {
  return `${n} ${n === 1 ? 'skill' : 'skills'}`;
}

/** The `pan skills add` sentence for each outcome (PRD WI-6), with the restart hint pointing at the dialog's button. */
export function outcomeSentence(outcome: SkillApplyOutcome, added: number, conv: string): string {
  const n = countSkills(added);
  switch (outcome) {
    case 'hot':
      return `Added ${n} to ${conv}. They are available now.`;
    case 'sent':
      return `Added ${n} to ${conv} and sent /reload-plugins; the reload was not confirmed. Check the conversation.`;
    case 'queued':
      return `Added ${n} to ${conv}. The reload runs when its current turn ends.`;
    case 'needs-restart':
      return `Saved ${n} on ${conv}. This conversation must restart to load them; Restart and load resumes it with its history.`;
    case 'restarted':
      return `Added ${n} to ${conv} and resumed it.`;
    case 'next-launch':
      return `Saved ${n} on ${conv}. They load when it resumes.`;
  }
}

function skillsPath(name: string): string {
  return `/api/conversations/${encodeURIComponent(name)}/skills`;
}

async function fetchConversationSkills(name: string): Promise<ConversationSkillsResponse> {
  const res = await fetch(skillsPath(name));
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as ConversationSkillsResponse;
}

async function postConversationSkills(name: string, body: SkillChangeBody & { restart?: boolean }): Promise<SkillApplyResult> {
  const res = await fetch(skillsPath(name), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Failed to add skills');
  return data as SkillApplyResult;
}

export interface AddSkillsModalProps {
  conversation: Conversation;
  onClose: () => void;
}

export function AddSkillsModal({ conversation, onClose }: AddSkillsModalProps) {
  const queryClient = useQueryClient();
  const queryKey = ['conversation-skills', conversation.name];
  const loaded = useQuery({ queryKey, queryFn: () => fetchConversationSkills(conversation.name) });
  // The operator's choices; until the first change the dialog shows the loaded map.
  const [edited, setEdited] = useState<Record<string, boolean> | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SkillApplyResult | null>(null);
  const [sentBody, setSentBody] = useState<SkillChangeBody | null>(null);

  const loadedMap = loaded.data?.skillOverrides;
  const value = edited ?? loadedMap ?? null;

  const change = loadedMap && value ? skillChangeBody(loadedMap, value) : {};
  const changed = Boolean(change.skills || change.off);
  const label = conversation.title?.trim() || conversation.name;

  const submit = async (body: SkillChangeBody, restart = false) => {
    setPending(true);
    setError(null);
    try {
      const applied = await postConversationSkills(conversation.name, restart ? { ...body, restart: true } : body);
      setSentBody(body);
      setResult(applied);
      // Every outcome stores the map: refetch it so the diff against the new baseline is empty again.
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    // No `finally`: the React Compiler cannot lower a try with a finalizer, and the catch above swallows every error.
    setPending(false);
  };

  return (
    <Modal
      title="Add skills"
      size="wide"
      onClose={onClose}
      pinned={
        error || result ? (
          <div className={formStyles.notice} role="status">
            {error && <p className={formStyles.error}>{error}</p>}
            {result && <p>{outcomeSentence(result.outcome, result.added.length, label)}</p>}
            {result?.warnings.map((warning) => <p key={warning} className={formStyles.hint}>{warning}</p>)}
          </div>
        ) : undefined
      }
      footer={
        <>
          <button type="button" className={formStyles.button} onClick={onClose}>
            {result ? 'Close' : 'Cancel'}
          </button>
          {result?.outcome === 'needs-restart' && sentBody && (
            <button
              type="button"
              className={formStyles.button}
              disabled={pending}
              onClick={() => void submit(sentBody, true)}
            >
              Restart and load
            </button>
          )}
          <button
            type="button"
            className={formStyles.primaryButton}
            disabled={!changed || pending}
            onClick={() => void submit(change)}
          >
            {pending ? 'Adding…' : 'Add skills'}
          </button>
        </>
      }
    >
      <div className={formStyles.form}>
        <p className={formStyles.hint}>
          Turn pack skills on or off for {label}. A running Claude Code conversation loads them in place; Codex
          conversations and native skills need a restart.
        </p>
        {loaded.isLoading && <p className={formStyles.hint}>Loading this conversation&apos;s skills…</p>}
        {loaded.isError && (
          <p className={formStyles.error}>
            Could not load this conversation&apos;s skills: {loaded.error instanceof Error ? loaded.error.message : 'unknown error'}
          </p>
        )}
        {value && (
          <ConversationSkillsField
            projectKey={conversation.projectKey ?? undefined}
            issueId={conversation.issueId ?? undefined}
            value={value}
            onChange={setEdited}
          />
        )}
      </div>
    </Modal>
  );
}
