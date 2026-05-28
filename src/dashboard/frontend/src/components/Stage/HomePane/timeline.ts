export interface TimelineConversation {
  /** Conversation id used to open/focus the agent pane. */
  id: string
  agentLabel?: string
  /** Activity time — ms epoch or ISO string. */
  timestamp: number | string
  preview?: string
}

export interface TimelineGroup {
  label: string
  items: TimelineConversation[]
}

const DAY_MS = 86_400_000
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function toEpoch(value: number | string): number {
  const ms = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? ms : 0
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Date-group label for a timestamp relative to `now`. */
export function dateGroupLabel(ts: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return WEEKDAYS[new Date(ts).getDay()]
  const d = new Date(ts)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** Short relative time, e.g. "just now", "5m ago", "2h ago", "3d ago". */
export function relativeTime(ts: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - ts) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/** Group conversations by date bucket, newest group and item first. */
export function groupConversationsByDate(
  conversations: TimelineConversation[],
  now: number,
): TimelineGroup[] {
  const sorted = [...conversations].sort((a, b) => toEpoch(b.timestamp) - toEpoch(a.timestamp))
  const groups: TimelineGroup[] = []
  for (const c of sorted) {
    const label = dateGroupLabel(toEpoch(c.timestamp), now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(c)
    else groups.push({ label, items: [c] })
  }
  return groups
}
