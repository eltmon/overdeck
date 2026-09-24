/**
 * Merge-train configuration (D3). The auto-merge knobs moved off the deleted
 * flywheel routes onto /api/merge-train/config, which is the only place the
 * dashboard reads or writes them.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface MergeTrainConfig {
  auto_pickup_backlog: boolean;
  require_uat_before_merge: boolean;
  merge_train_enabled: boolean;
}

export type MergeTrainConfigPatch = Partial<MergeTrainConfig>;

export const MERGE_TRAIN_CONFIG_QUERY_KEY = ['merge-train', 'config'];

export function useMergeTrainConfig() {
  return useQuery({
    queryKey: MERGE_TRAIN_CONFIG_QUERY_KEY,
    queryFn: async (): Promise<MergeTrainConfig> => {
      const res = await fetch('/api/merge-train/config');
      if (!res.ok) throw new Error(`GET /api/merge-train/config → ${res.status}`);
      return res.json() as Promise<MergeTrainConfig>;
    },
    staleTime: 5_000,
  });
}

export function useMergeTrainConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: MergeTrainConfigPatch): Promise<MergeTrainConfig> => {
      const res = await fetch('/api/merge-train/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `POST /api/merge-train/config → ${res.status}`);
      }
      return res.json() as Promise<MergeTrainConfig>;
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: MERGE_TRAIN_CONFIG_QUERY_KEY });
      const previous = queryClient.getQueryData<MergeTrainConfig>(MERGE_TRAIN_CONFIG_QUERY_KEY);
      queryClient.setQueryData<MergeTrainConfig>(MERGE_TRAIN_CONFIG_QUERY_KEY, {
        auto_pickup_backlog: previous?.auto_pickup_backlog ?? false,
        require_uat_before_merge: previous?.require_uat_before_merge ?? true,
        merge_train_enabled: previous?.merge_train_enabled ?? false,
        ...patch,
      });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      queryClient.setQueryData(MERGE_TRAIN_CONFIG_QUERY_KEY, context?.previous);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(MERGE_TRAIN_CONFIG_QUERY_KEY, data);
    },
  });
}
