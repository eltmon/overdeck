/** Shimmer skeleton for the Kanban board — matches the 4-column layout (todo → done). */
export function KanbanSkeleton() {
  const columns = [
    { title: 'Todo', color: 'border-primary' },
    { title: 'In Progress', color: 'border-yellow-500' },
    { title: 'In Review', color: 'border-purple-500' },
    { title: 'Done', color: 'border-success' },
  ]

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => (
        <div
          key={col.title}
          className={`border-t-4 ${col.color} bg-card rounded-lg min-w-[280px] flex-1`}
        >
          {/* Column header */}
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="h-4 w-24 animate-pulse bg-muted rounded" />
              <div className="h-4 w-6 animate-pulse bg-muted rounded" />
            </div>
          </div>

          {/* Card placeholders */}
          <div className="p-3 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-card rounded-lg p-3 space-y-2">
                <div className="h-3 w-3/4 animate-pulse bg-muted rounded" />
                <div className="h-3 w-1/2 animate-pulse bg-muted rounded" />
                <div className="flex gap-2 mt-2">
                  <div className="h-5 w-16 animate-pulse bg-muted rounded" />
                  <div className="h-5 w-10 animate-pulse bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
