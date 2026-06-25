import { useMemo } from 'react'
import {
  groupConversationsByDate,
  relativeTime,
  toEpoch,
  type TimelineConversation,
} from './timeline-utils'
import { ProviderIcon } from '../../shared/branding'
import styles from '../stage.module.css'

export interface TimelineProps {
  conversations: TimelineConversation[]
  /** Open or focus the agent pane for this conversation. */
  onOpen: (conversationId: string) => void
  /** Injectable clock for deterministic relative times; defaults to Date.now(). */
  now?: number
}

/**
 * Timeline — the HomePane conversation history (PAN-1549). The workspace's
 * conversations grouped by date (Today / Yesterday / weekday / date); each card
 * shows the agent, relative time, and a preview. Clicking a card asks the
 * consumer to open or focus an agent pane bound to that conversation.
 */
export function Timeline({ conversations, onOpen, now = Date.now() }: TimelineProps) {
  // Group + pre-resolve epochs once per data change rather than on every render.
  const groups = useMemo(() => groupConversationsByDate(conversations, now), [conversations, now])

  if (conversations.length === 0) {
    return <div className={styles.timelineEmpty}>No conversations yet.</div>
  }
  return (
    <div className={styles.timeline}>
      {groups.map((group) => (
        // Key by the first item's id, not the label — "May 28" repeats across
        // years and would otherwise collide.
        <section key={group.items[0]?.id ?? group.label} className={styles.timelineGroup}>
          <h4 className={styles.timelineLabel}>{group.label}</h4>
          {group.items.map((c) => (
            <button
              key={c.id}
              type="button"
              className={styles.timelineCard}
              onClick={() => onOpen(c.id)}
            >
              <div className={styles.timelineCardHead}>
                <span className={styles.timelineAgentWrap}>
                  <span className={styles.timelineModelIcon}>
                    <ProviderIcon provider={providerForConversation(c)} label={c.model ?? c.harness ?? 'model'} />
                  </span>
                  <span className={styles.timelineAgent}>{c.agentLabel ?? 'Agent'}</span>
                </span>
                <span className={styles.timelineTime}>{relativeTime(toEpoch(c.timestamp), now)}</span>
              </div>
              {c.model && <div className={styles.timelineModel}>{friendlyModelName(c.model)}</div>}
              {c.preview && <div className={styles.timelinePreview}>{c.preview}</div>}
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}

function providerForConversation(conversation: TimelineConversation): string {
  const model = conversation.model?.toLowerCase() ?? '';
  const harness = conversation.harness?.toLowerCase() ?? '';
  if (model.startsWith('claude') || harness === 'claude-code') return 'anthropic';
  if (model.startsWith('gpt') || model.startsWith('o') || harness === 'codex') return 'openai';
  if (model.includes('gemini')) return 'google';
  if (model.includes('kimi')) return 'kimi';
  if (model.includes('minimax')) return 'minimax';
  if (model.includes('zai') || model.includes('glm')) return 'zai';
  if (model.includes('mimo')) return 'mimo';
  if (model.includes('nous')) return 'nous';
  if (model.includes('dashscope') || model.includes('qwen')) return 'dashscope';
  if (model.includes('/')) return 'openrouter';
  return harness === 'ohmypi' || harness === 'pi' ? 'openrouter' : 'openai';
}

function friendlyModelName(model: string): string {
  return model
    .replace(/-20\d{6}$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
