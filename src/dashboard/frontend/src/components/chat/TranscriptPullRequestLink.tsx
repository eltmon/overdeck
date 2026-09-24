import { createContext, useContext, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GitPullRequest, Unlink } from 'lucide-react';
import { parsePullRequestRef, type PullRequestLink } from '@overdeck/contracts';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRoot,
  ContextMenuTrigger,
} from '../shared/ContextMenu';

/**
 * PAN-3822 WI-7: right-click a pull request URL in a conversation transcript
 * to link it to (or unlink it from) that conversation. ConversationPanel
 * provides the open conversation; ChatMarkdown renders every link through
 * `TranscriptLink`, which adds the menu only for PR/MR URLs inside a
 * conversation. Everywhere else it is a plain link.
 */

interface ConversationPullRequestContextValue {
  conversationName: string;
  effective: PullRequestLink | null;
}

const ConversationPullRequestContext = createContext<ConversationPullRequestContextValue | null>(null);

export function ConversationPullRequestProvider({ conversation, children }: {
  conversation: { name: string; pullRequest?: PullRequestLink | null };
  children: ReactNode;
}) {
  return (
    <ConversationPullRequestContext.Provider value={{ conversationName: conversation.name, effective: conversation.pullRequest ?? null }}>
      {children}
    </ConversationPullRequestContext.Provider>
  );
}

export function TranscriptLink({ href, className, children }: { href: string | undefined; className?: string; children: ReactNode }) {
  const context = useContext(ConversationPullRequestContext);
  const ref = context && href ? parsePullRequestRef(href) : null;
  const anchor = (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
  if (!context || !ref) return anchor;
  return <PullRequestLinkMenu context={context} prRef={ref} anchor={anchor} />;
}

function PullRequestLinkMenu({ context, prRef, anchor }: {
  context: ConversationPullRequestContextValue;
  prRef: NonNullable<ReturnType<typeof parsePullRequestRef>>;
  anchor: ReactNode;
}) {
  const queryClient = useQueryClient();
  const { conversationName, effective } = context;
  const isShown = effective !== null && effective.host === prRef.host
    && effective.repository === prRef.repository && effective.number === prRef.number;
  const base = `/api/conversations/${encodeURIComponent(conversationName)}/pull-requests`;

  const run = async (request: Promise<Response>, success: string) => {
    try {
      const res = await request;
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error || 'Request failed');
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation-pull-requests', conversationName] });
      toast.success(success, { duration: 4000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { duration: 6000 });
    }
  };

  return (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>{anchor}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{prRef.repository}#{prRef.number}</ContextMenuLabel>
        {isShown ? (
          <ContextMenuItem onSelect={() => { void run(fetch(`${base}?ref=${encodeURIComponent(prRef.url)}`, { method: 'DELETE' }), `Unlinked #${prRef.number}`); }}>
            <Unlink size={14} />
            Unlink from conversation
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            onSelect={() => {
              void run(fetch(base, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ref: prRef.url }),
              }), `Linked ${prRef.repository}#${prRef.number}`);
            }}
          >
            <GitPullRequest size={14} />
            Link to conversation
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}
