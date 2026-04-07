import { useEffect, useState } from 'react'

interface SystemHealthResponse {
  memUsed: number
  memTotal: number
  memFree: number
  memPercent: number
  cpu: number
  warnThresholdBytes: number
  blockThresholdBytes: number
  updatedAt: string
}

function formatGB(bytes: number): string {
  return (bytes / (1024 ** 3)).toFixed(0)
}

export function MemoryIndicator() {
  const [health, setHealth] = useState<SystemHealthResponse | null>(null)

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

  if (!health || health.memTotal === 0) return null

  const memFreeBytes = health.memFree ?? (health.memTotal - health.memUsed)
  const freePercent = (memFreeBytes / health.memTotal) * 100

  let dotColor: string
  if (freePercent > 30) {
    dotColor = '#22c55e' // green
  } else if (freePercent > 15) {
    dotColor = '#eab308' // yellow
  } else {
    dotColor = '#ef4444' // red
  }

  const usedGB = formatGB(health.memUsed)
  const totalGB = formatGB(health.memTotal)

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] whitespace-nowrap shrink-0"
      style={{ backgroundColor: '#1a2236', color: '#92a4c9' }}
      title={`Memory: ${usedGB} GB used, ${formatGB(memFreeBytes)} GB free of ${totalGB} GB`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: dotColor }}
      />
      <span>
        {usedGB} / {totalGB} GB
      </span>
    </div>
  )
}
