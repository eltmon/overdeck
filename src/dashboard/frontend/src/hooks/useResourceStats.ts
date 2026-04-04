/**
 * useResourceStats — bridges Zustand store resources into TanStack Query cache.
 *
 * The EventRouter applies `resources.updated` domain events to the store.
 * This hook syncs that data into the ['resources'] query key so components
 * using useQuery(['resources']) get live updates without polling.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDashboardStore, selectResources } from '../lib/store';

export function useResourceStats(): void {
  const queryClient = useQueryClient();
  const resources = useDashboardStore(selectResources);

  useEffect(() => {
    if (resources) {
      queryClient.setQueryData(['resources'], resources);
    }
  }, [resources, queryClient]);
}
