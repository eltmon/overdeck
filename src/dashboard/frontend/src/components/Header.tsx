// Header.tsx — Tab type definition (navigation is now in Sidebar.tsx)
// The Tab type is exported here since App.tsx and other components import it.

export type Tab =
  | 'home'
  | 'pipeline'
  | 'kanban'
  | 'command-deck'
  | 'agents'
  | 'flywheel'
  | 'resources'
  | 'skills'
  | 'context'
  | 'health'
  | 'activity'
  | 'metrics'
  | 'costs'
  | 'autopreso'
  | 'settings'
  | 'god-view'
  | 'deacon'
  | 'sessions'
  | 'awaiting-merge';
