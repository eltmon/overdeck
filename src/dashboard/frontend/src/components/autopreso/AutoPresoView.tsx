export function AutoPresoView() {
  return (
    <div className="flex h-full w-full flex-col bg-background p-6 text-foreground">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">AutoPreso</p>
        <h1 className="mt-2 text-2xl font-semibold">Voice whiteboard</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          The AutoPreso canvas and voice controls will appear here as the whiteboard beads land.
        </p>
      </div>
    </div>
  );
}
