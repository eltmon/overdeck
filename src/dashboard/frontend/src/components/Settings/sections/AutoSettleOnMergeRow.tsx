/** PAN-4653: the conversations.auto_settle_on_merge switch (app_settings, not settings YAML). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface AutoSettleOnMergeSetting {
  enabled: boolean;
}

/** Deliberately not under ['conversations'], which many list mutations invalidate. */
export const AUTO_SETTLE_ON_MERGE_QUERY_KEY = ['conversation-auto-settle-on-merge'];

const ENDPOINT = '/api/conversations/auto-settle-on-merge';

export function AutoSettleOnMergeRow() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: AUTO_SETTLE_ON_MERGE_QUERY_KEY,
    queryFn: async (): Promise<AutoSettleOnMergeSetting> => {
      const res = await fetch(ENDPOINT);
      if (!res.ok) throw new Error(`GET ${ENDPOINT} → ${res.status}`);
      return res.json() as Promise<AutoSettleOnMergeSetting>;
    },
    staleTime: 5_000,
  });

  const mutation = useMutation({
    mutationFn: async (enabled: boolean): Promise<AutoSettleOnMergeSetting> => {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `POST ${ENDPOINT} → ${res.status}`);
      }
      return res.json() as Promise<AutoSettleOnMergeSetting>;
    },
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey: AUTO_SETTLE_ON_MERGE_QUERY_KEY });
      const previous = queryClient.getQueryData<AutoSettleOnMergeSetting>(AUTO_SETTLE_ON_MERGE_QUERY_KEY);
      queryClient.setQueryData<AutoSettleOnMergeSetting>(AUTO_SETTLE_ON_MERGE_QUERY_KEY, { enabled });
      return { previous };
    },
    onError: (error, _enabled, context) => {
      queryClient.setQueryData(AUTO_SETTLE_ON_MERGE_QUERY_KEY, context?.previous);
      toast.error(error.message);
    },
    onSuccess: (result) => {
      queryClient.setQueryData(AUTO_SETTLE_ON_MERGE_QUERY_KEY, result);
    },
  });

  const enabled = data?.enabled ?? false;

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
      <div className="min-w-0">
        <span className="text-sm font-medium text-foreground">Auto-settle on merge</span>
        <p className="text-xs text-muted-foreground mt-0.5">
          Settle a conversation when every pull request linked to it is merged or closed. Override it per conversation from the conversation's menu.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Toggle auto-settle on merge"
        disabled={data === undefined}
        onClick={() => mutation.mutate(!enabled)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
          enabled ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`} />
      </button>
    </div>
  );
}
