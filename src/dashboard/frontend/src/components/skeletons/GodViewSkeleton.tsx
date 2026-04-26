/** Shimmer skeleton for God View — matches the grid + sidebar layout. */
export function GodViewSkeleton() {
  return (
    <div className="god-view flex flex-col h-full">
      {/* Top bar skeleton */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="h-4 w-48 animate-pulse bg-muted rounded" />
        <div className="h-4 w-24 animate-pulse bg-muted rounded" />
      </div>

      {/* Main content */}
      <div className="flex flex-1 gap-3 px-3 pb-3 pt-2 min-h-0 overflow-hidden">
        {/* Agent grid */}
        <div className="flex-1 grid grid-cols-3 gap-3 content-start overflow-auto">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-card rounded-lg p-3 space-y-2 min-h-[120px]">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 animate-pulse bg-muted rounded-full" />
                <div className="h-3 w-24 animate-pulse bg-muted rounded" />
              </div>
              <div className="h-3 w-3/4 animate-pulse bg-muted rounded" />
              <div className="h-3 w-1/2 animate-pulse bg-muted rounded" />
              <div className="h-16 animate-pulse bg-muted rounded mt-2" />
            </div>
          ))}
        </div>

        {/* Sidebar */}
        <div className="w-[220px] shrink-0 space-y-3">
          <div className="bg-card rounded-lg p-3">
            <div className="h-3 w-20 animate-pulse bg-muted rounded mb-3" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5">
                <div className="h-2 w-2 animate-pulse bg-muted rounded-full" />
                <div className="h-3 flex-1 animate-pulse bg-muted rounded" />
              </div>
            ))}
          </div>
          <div className="bg-card rounded-lg p-3">
            <div className="h-3 w-24 animate-pulse bg-muted rounded mb-3" />
            <div className="h-32 animate-pulse bg-muted rounded" />
          </div>
        </div>
      </div>
    </div>
  )
}
