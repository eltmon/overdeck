/**
 * HeaderSkeleton — placeholder for the header area during bootstrap.
 *
 * The current Header renders static nav items with no store-dependent content,
 * so this skeleton is a minimal placeholder used when BootstrapGate needs a
 * header-area fallback in future layouts that add store-driven count badges.
 */
export function HeaderSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 h-[60px] animate-pulse">
      {/* Logo placeholder */}
      <div className="h-5 w-28 bg-muted rounded shrink-0" />
      {/* Nav items placeholder */}
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-6 w-16 bg-muted rounded" />
      ))}
    </div>
  );
}
