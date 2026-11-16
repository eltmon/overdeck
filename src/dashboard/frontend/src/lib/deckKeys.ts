/**
 * deckKeys — deck keys that are not project keys (PAN-5343 H-D1).
 *
 * A leaf module with no imports, so `panesStore.ts` can import the All
 * projects key without importing `projectsData.ts` (which pulls in
 * `wsTransport`) and creating an import cycle.
 */

/** The All projects deck: panes may be conversations from any project; it has no Home pane. */
export const ALL_PROJECTS_KEY = '__all-projects__';
export const ALL_PROJECTS_LABEL = 'All projects';
