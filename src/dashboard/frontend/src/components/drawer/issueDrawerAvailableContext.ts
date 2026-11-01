import { createContext } from 'react';

/**
 * PAN-4714 review fix: `<IssueDrawer />` is mounted only in the main
 * dashboard layout (`App.tsx`), not in the standalone pop-outs
 * (`/popout/conversation/<id>`, `/popout/flywheel-conversation`) or the
 * mobile app (`/m`) — all of which still render `ConversationPanel`.
 * `TranscriptIssueLink` reads this context to decide whether a plain click
 * can open the drawer; it defaults to `false` so those hosts keep today's
 * new-tab behaviour instead of a click that silently rewrites the URL and
 * renders nothing. Only the layout that renders `<IssueDrawer />` provides
 * `true`.
 *
 * This lives in its own leaf module (no React-component imports) because
 * `IssueDrawer.tsx` pulls in `IssueDetail` → `DrawerAgentSession` →
 * `ConversationPanel` → `ChatMarkdown`; a consumer as deep in the tree as
 * `TranscriptIssueLink` importing the context from `IssueDrawer.tsx` closes
 * a circular dependency back to itself (`lint:circular`, PAN-4714).
 */
export const IssueDrawerAvailableContext = createContext(false);
