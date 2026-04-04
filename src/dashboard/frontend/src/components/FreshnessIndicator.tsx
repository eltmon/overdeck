/**
 * FreshnessIndicator — shows how fresh the dashboard data is (PAN-437)
 *
 * States:
 *   - No timestamp: nothing shown (loading)
 *   - Stale (> 30s old): "Data from Xm ago" in muted text
 *   - Recent (< 30s): "Just now" that fades after 5s
 *
 * Positioned in the header bar. Updates every 10 seconds.
 */

import { useEffect, useState } from 'react'
import { useDashboardStore } from '../lib/store'

function formatAge(ageMs: number): string {
  const secs = Math.floor(ageMs / 1000)
  if (secs < 10) return 'Just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  return `${hours}h ago`
}

export function FreshnessIndicator() {
  const snapshotTimestamp = useDashboardStore((s) => s.snapshotTimestamp)
  const [, setTick] = useState(0)
  const [visible, setVisible] = useState(true)

  // Re-render every 10s to update the displayed age
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000)
    return () => clearInterval(id)
  }, [])

  // When timestamp changes to a fresh value, show "Just now" then fade after 5s
  useEffect(() => {
    if (!snapshotTimestamp) return
    const age = Date.now() - new Date(snapshotTimestamp).getTime()
    if (age < 5000) {
      setVisible(true)
      const id = setTimeout(() => setVisible(false), 5000)
      return () => clearTimeout(id)
    } else {
      setVisible(true)
    }
  }, [snapshotTimestamp])

  if (!snapshotTimestamp) return null

  const ageMs = Date.now() - new Date(snapshotTimestamp).getTime()
  const label = formatAge(ageMs)
  const isJustNow = ageMs < 5000

  if (isJustNow && !visible) return null

  return (
    <span
      className="text-[11px] whitespace-nowrap transition-opacity duration-500"
      style={{
        color: isJustNow ? '#4ade80' : '#4a5c80',
        opacity: visible ? 1 : 0,
      }}
      title={`Data timestamp: ${snapshotTimestamp}`}
    >
      {label}
    </span>
  )
}
