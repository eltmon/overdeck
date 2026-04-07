import { useEffect, useState, useRef } from 'react'
import { AlertTriangle, X, Square } from 'lucide-react'
import { useDashboardStore, selectAgentList } from '../lib/store'

// Default warning threshold: 4 GB free (matches backend default PAN_MEMORY_WARN_GB)
const WARN_THRESHOLD_BYTES = 4 * 1024 ** 3

// Re-show after dismiss if free memory drops another 512 MB below dismiss point
const REDISPLAY_DROP_BYTES = 512 * 1024 * 1024

interface SystemHealthResponse {
  memUsed: number
  memTotal: number
  memPercent: number
  cpu: number
  updatedAt: string
}

function formatGBDecimal(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1)
}

export function MemoryWarningBanner() {
  const [health, setHealth] = useState<SystemHealthResponse | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const dismissedAtFreeRef = useRef<number | null>(null)
  const agents = useDashboardStore(selectAgentList)

  useEffect(() => {
    let mounted = true

    async function fetchHealth() {
      try {
        const res = await fetch('/api/godview/system-health')
        if (res.ok && mounted) {
          const data = await res.json()
          setHealth(data)
        }
      } catch {
        // ignore network errors
      }
    }

    fetchHealth()
    const id = setInterval(fetchHealth, 10_000)
    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [])

  // Re-show if memory drops another REDISPLAY_DROP_BYTES below where user dismissed
  useEffect(() => {
    if (!dismissed || !health || health.memTotal === 0) return
    const memFree = health.memTotal - health.memUsed
    const dismissedAt = dismissedAtFreeRef.current
    if (dismissedAt !== null && memFree < dismissedAt - REDISPLAY_DROP_BYTES) {
      setDismissed(false)
      dismissedAtFreeRef.current = null
    }
  }, [dismissed, health])

  if (!health || health.memTotal === 0) return null

  const memFreeBytes = health.memTotal - health.memUsed
  if (memFreeBytes >= WARN_THRESHOLD_BYTES) return null
  if (dismissed) return null

  const isCritical = memFreeBytes < 2 * 1024 ** 3 // < 2 GB = critical

  const runningAgents = agents
    .filter((a) => a.status === 'running' || a.status === 'starting')
    .slice(0, 5)

  function handleDismiss() {
    dismissedAtFreeRef.current = memFreeBytes
    setDismissed(true)
  }

  async function handleKill(agentId: string) {
    try {
      await fetch(`/api/agents/${agentId}`, { method: 'DELETE' })
    } catch {
      // ignore
    }
  }

  const borderColor = isCritical ? '#ef4444' : '#f59e0b'
  const bgColor = isCritical ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)'
  const textColor = isCritical ? '#fca5a5' : '#fcd34d'
  const iconColor = isCritical ? '#ef4444' : '#f59e0b'

  return (
    <div
      className="shrink-0 px-4 py-2 flex items-start gap-3 border-b"
      style={{ backgroundColor: bgColor, borderColor }}
    >
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: iconColor }} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: textColor }}>
          System memory low: {formatGBDecimal(memFreeBytes)} GB free of{' '}
          {formatGBDecimal(health.memTotal)} GB
          {isCritical && ' — new agent spawns blocked'}
        </p>

        {runningAgents.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {runningAgents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-1.5 text-xs"
                style={{ color: '#92a4c9' }}
              >
                <span className="font-mono truncate max-w-[160px]" title={agent.id}>
                  {agent.issueId ?? agent.id}
                </span>
                <button
                  onClick={() => handleKill(agent.id)}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors hover:opacity-80"
                  style={{ backgroundColor: 'rgba(239,68,68,0.2)', color: '#fca5a5' }}
                  title={`Kill agent ${agent.id}`}
                >
                  <Square className="w-2.5 h-2.5" />
                  Kill
                </button>
              </div>
            ))}
          </div>
        )}

        {isCritical && (
          <p className="text-xs mt-1" style={{ color: '#92a4c9' }}>
            Consider offloading to a remote runner:{' '}
            <code className="font-mono text-[11px]">pan issue &lt;id&gt; --remote</code>
          </p>
        )}
      </div>

      <button
        onClick={handleDismiss}
        className="shrink-0 p-0.5 rounded transition-colors hover:opacity-70"
        style={{ color: '#92a4c9' }}
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
