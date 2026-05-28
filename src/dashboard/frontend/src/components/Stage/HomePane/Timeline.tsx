import { useMemo } from 'react'
import {
  groupConversationsByDate,
  relativeTime,
  toEpoch,
  type TimelineConversation,
} from './timeline'
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
        <section key={group.label} className={styles.timelineGroup}>
          <h4 className={styles.timelineLabel}>{group.label}</h4>
          {group.items.map((c) => (
            <button
              key={c.id}
              type="button"
              className={styles.timelineCard}
              onClick={() => onOpen(c.id)}
            >
              <div className={styles.timelineCardHead}>
                <span className={styles.timelineAgent}>{c.agentLabel ?? 'Agent'}</span>
                <span className={styles.timelineTime}>{relativeTime(toEpoch(c.timestamp), now)}</span>
              </div>
              {c.preview && <div className={styles.timelinePreview}>{c.preview}</div>}
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}
