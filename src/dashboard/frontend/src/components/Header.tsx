// Header.tsx — Tab type definition (navigation is now in Sidebar.tsx)
// The Tab type is exported here since App.tsx and other components import it.

export type Tab =
  | 'command-deck'
  | 'kanban'
  | 'agents'
  | 'resources'
  | 'skills'
  | 'health'
  | 'activity'
  | 'metrics'
  | 'costs'
  | 'handoffs'
  | 'awaiting-merge'
  | 'settings'
  | 'god-view';
