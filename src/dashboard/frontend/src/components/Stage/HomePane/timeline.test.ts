import { describe, it, expect } from 'vitest'
import { groupConversationsByDate, dateGroupLabel, relativeTime } from './timeline'

const NOW = new Date('2026-05-28T12:00:00Z').getTime()
const DAY = 86_400_000

describe('dateGroupLabel', () => {
  it('labels today / yesterday / weekday / date (timezone-independent offsets)', () => {
    expect(dateGroupLabel(NOW, NOW)).toBe('Today')
    expect(dateGroupLabel(NOW - DAY, NOW)).toBe('Yesterday')
    // 3 days earlier — a weekday name (exact name depends on locale tz).
    expect(dateGroupLabel(NOW - 3 * DAY, NOW)).toMatch(
      /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/,
    )
    // > 7 days earlier — "Mon D" form.
    expect(dateGroupLabel(NOW - 27 * DAY, NOW)).toMatch(/^[A-Z][a-z]{2} \d+$/)
  })
})

describe('relativeTime', () => {
  it('formats coarse relative times', () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe('just now')
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5m ago')
    expect(relativeTime(NOW - 2 * 3_600_000, NOW)).toBe('2h ago')
    expect(relativeTime(NOW - 3 * DAY, NOW)).toBe('3d ago')
  })
})

describe('groupConversationsByDate', () => {
  it('groups newest-first by date bucket', () => {
    const groups = groupConversationsByDate(
      [
        { id: 'a', timestamp: NOW - DAY }, // yesterday
        { id: 'b', timestamp: NOW - 60_000 }, // today (older)
        { id: 'c', timestamp: NOW }, // today (newer)
      ],
      NOW,
    )
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday'])
    expect(groups[0].items.map((i) => i.id)).toEqual(['c', 'b'])
    expect(groups[1].items.map((i) => i.id)).toEqual(['a'])
  })
})
