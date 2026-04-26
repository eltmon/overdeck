/** Shimmer skeleton for the Agents tab — matches the two-panel grid layout. */
export function AgentListSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 w-full">
      {/* Left panel — agent list */}
      <div className="bg-card rounded-lg">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="h-4 w-36 animate-pulse bg-muted rounded" />
          <div className="h-6 w-20 animate-pulse bg-muted rounded" />
        </div>
        <div className="divide-y divide-divider">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 animate-pulse bg-muted rounded-full" />
                <div className="space-y-1.5">
                  <div className="h-3 w-32 animate-pulse bg-muted rounded" />
                  <div className="h-3 w-20 animate-pulse bg-muted rounded" />
                </div>
              </div>
              <div className="h-5 w-16 animate-pulse bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — placeholder for output panel */}
      <div className="bg-card rounded-lg p-4">
        <div className="h-4 w-28 animate-pulse bg-muted rounded mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-3 animate-pulse bg-muted rounded" style={{ width: `${60 + (i % 3) * 15}%` }} />
          ))}
        </div>
      </div>
    </div>
  )
}
