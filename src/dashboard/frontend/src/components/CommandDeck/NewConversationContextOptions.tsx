/**
 * PAN-4185: context opt-outs for conversations started from the Command Deck
 * `+`. The choice is remembered per browser and sent with the create request;
 * the server stores it on the conversation so resume, restart and fork keep it.
 */
import type { Harness } from '../shared/ModelPicker';
import styles from './styles/command-deck.module.css';

export interface NewConversationContext {
  /** Skip every Overdeck-injected layer (bundled rules, briefing, memory hooks). */
  bareContext: boolean;
  /** Claude Code only: skip native CLAUDE.md files and auto memory. */
  skipClaudeMd: boolean;
}

export const NEW_CONVERSATION_CONTEXT_STORAGE_KEY = 'overdeck.commandDeck.newConversationContext';

const DEFAULT_CONTEXT: NewConversationContext = { bareContext: false, skipClaudeMd: false };

export function loadStoredNewConversationContext(): NewConversationContext {
  try {
    const raw = localStorage.getItem(NEW_CONVERSATION_CONTEXT_STORAGE_KEY);
    if (!raw) return DEFAULT_CONTEXT;
    const parsed = JSON.parse(raw) as Partial<NewConversationContext>;
    return { bareContext: parsed.bareContext === true, skipClaudeMd: parsed.skipClaudeMd === true };
  } catch {
    return DEFAULT_CONTEXT;
  }
}

export function saveStoredNewConversationContext(context: NewConversationContext): void {
  try {
    localStorage.setItem(NEW_CONVERSATION_CONTEXT_STORAGE_KEY, JSON.stringify(context));
  } catch { /* storage unavailable: the choice lasts for this page only */ }
}

/** The create-request fields for a context choice under the given harness. */
export function newConversationContextPayload(context: NewConversationContext, harness: Harness): Record<string, boolean> {
  const payload: Record<string, boolean> = {};
  if (context.bareContext) payload.bareContext = true;
  if (context.skipClaudeMd && harness === 'claude-code') payload.skipClaudeMd = true;
  return payload;
}

interface NewConversationContextOptionsProps {
  value: NewConversationContext;
  onChange: (next: NewConversationContext) => void;
  harness: Harness;
}

/** Controlled by the caller; every change is also remembered for this browser. */
export function NewConversationContextOptions({ value, onChange: notify, harness }: NewConversationContextOptionsProps) {
  const onChange = (next: NewConversationContext) => {
    saveStoredNewConversationContext(next);
    notify(next);
  };
  return (
    <div className={styles.newConversationOptions} role="group" aria-label="New conversation context">
      <label
        className={styles.conversationResumeContractToggle}
        title="New conversations start without Overdeck context: no bundled rules, session briefing, memory injection or resume message. Faster to spawn."
      >
        <input
          type="checkbox"
          checked={value.bareContext}
          onChange={(event) => onChange({ ...value, bareContext: event.target.checked })}
        />
        No context
      </label>
      {harness === 'claude-code' && (
        <label
          className={styles.conversationResumeContractToggle}
          title="Claude Code skips ~/.claude/CLAUDE.md, project CLAUDE.md files and auto memory (CLAUDE_CODE_DISABLE_CLAUDE_MDS)."
        >
          <input
            type="checkbox"
            checked={value.skipClaudeMd}
            onChange={(event) => onChange({ ...value, skipClaudeMd: event.target.checked })}
          />
          Skip CLAUDE.md
        </label>
      )}
    </div>
  );
}
