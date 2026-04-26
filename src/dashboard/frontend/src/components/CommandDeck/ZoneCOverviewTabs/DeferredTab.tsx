/**
 * DeferredTab — placeholder for tabs whose backend endpoints land in follow-up
 * beads (PR / Diff → pan-9yn5, Discussions → pan-1r7j). Keeps the tab strip
 * navigable today without shipping fake data.
 */

interface DeferredTabProps {
  testId: string;
  title: string;
  bead: string;
}

export function DeferredTab({ testId, title, bead }: DeferredTabProps) {
  return (
    <div
      data-testid={testId}
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--mc-text-muted, var(--muted-foreground))' }}>
        Backend endpoint lands in follow-up bead <code>{bead}</code>. The tab is
        wired and discoverable so the UX is complete once the data is available.
      </div>
    </div>
  );
}
