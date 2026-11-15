/**
 * ConversationReferenceLink (PAN-5339 WI-5).
 *
 * Renders a resolved conversation reference as a link. A plain left click,
 * when a `ConversationLinkOpener` is available (FR-8: not in a pop-out,
 * `/m`, or the issue drawer), opens it in the dashboard the same way the
 * deck's own rows do; the guard mirrors `TranscriptIssueLink.tsx`. Every
 * other click (modified, middle, or with no opener) keeps the anchor's
 * normal new-tab behaviour on the `/conv/<routeKey>` href.
 */
import type { MouseEvent, ReactNode } from 'react';
import type { ConversationRef } from '../../lib/conversationReferences';
import { useConversationLinkOpener } from './ConversationLinkOpenerContext';

export function ConversationReferenceLink({ conversationRef, className, children }: {
  conversationRef: ConversationRef;
  className?: string;
  children: ReactNode;
}) {
  const open = useConversationLinkOpener();
  const href = `/conv/${conversationRef.routeKey}`;
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!open || event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open(conversationRef.conversation);
  };
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}
      title={conversationRef.title ?? conversationRef.name} data-conversation-id={conversationRef.routeKey} onClick={onClick}>
      {children}
    </a>
  );
}
