/** Phone conversation list and view (PAN-2355 FR-5). Placeholder until W-6 lands. */
export function MobileConversations({ conversationId, onBack }: {
  conversationId: string | null;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <section className="p-4">
      {conversationId !== null && (
        <button type="button" onClick={onBack} className="min-h-11 min-w-11 text-sm">Back</button>
      )}
      <h2 className="text-sm font-medium">Conversations</h2>
    </section>
  );
}
