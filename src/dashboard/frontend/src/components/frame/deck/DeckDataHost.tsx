/**
 * DeckDataHost — the one owner of the live session-tree subscription
 * (PAN-5293 F-D4). Renders nothing; the left column mounts it, so the deck
 * data stays live on every desktop route.
 */

import { useDeckProjects } from './useDeckProjects';
import { useSessionTreeSubscription } from './useSessionTreeSubscription';

export function DeckDataHost(): null {
  const { projects } = useDeckProjects();
  useSessionTreeSubscription(projects);
  return null;
}
