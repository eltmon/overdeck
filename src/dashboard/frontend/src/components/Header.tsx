// Header.tsx — Tab type definition (navigation is now in Sidebar.tsx)
// The Tab type is exported here since App.tsx and other components import it.

export type Tab =
  | 'command-deck'
  | 'kanban'
  | 'agents'
  | 'flywheel'
  | 'resources'
  | 'skills'
  | 'health'
  | 'activity'
  | 'metrics'
  | 'costs'
  | 'autopreso'
  | 'settings'
  | 'god-view'
  | 'sessions';
