/** Phone Needs-you list (PAN-2355 FR-4). Placeholder until W-5 lands. */
export function MobileNeedsYou({ subjectId }: { subjectId: string | null }) {
  return (
    <section className="p-4" data-subject-id={subjectId ?? undefined}>
      <h2 className="text-sm font-medium">Needs you</h2>
    </section>
  );
}
