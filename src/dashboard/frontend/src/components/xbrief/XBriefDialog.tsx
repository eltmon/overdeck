import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../shared/Modal';
import formStyles from '../shared/ModalForm.module.css';
import { XBriefViewer } from './XBriefViewer';
import type { XBriefDocument, XBriefInspectionPolicy } from './types';

interface XBriefDialogProps {
  issueId: string;
  onClose: () => void;
}

export function XBriefDialog({ issueId, onClose }: XBriefDialogProps) {
  const queryClient = useQueryClient();
  const queryKey = ['xbrief-plan', issueId];
  const { data: doc, isLoading, isError } = useQuery<XBriefDocument | null>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/plan`);
      if (!res.ok) return null;
      return res.json() as Promise<XBriefDocument>;
    },
    retry: false,
  });
  const updateInspectionPolicy = useMutation({
    mutationFn: async (inspectionPolicy: XBriefInspectionPolicy) => {
      const res = await fetch(`/api/workspaces/${issueId}/plan/inspection-policy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionPolicy }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res.json() as Promise<XBriefDocument>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, updated);
    },
  });

  return (
    <Modal title={`xBRIEF Plan: ${issueId}`} size="wide" onClose={onClose}>
      <div className={formStyles.content}>
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            Loading plan...
          </div>
        )}
        {isError && (
          <div className="flex items-center justify-center h-32 text-destructive text-sm">
            Failed to load plan
          </div>
        )}
        {!isLoading && !isError && (
          <XBriefViewer
            doc={doc ?? null}
            onInspectionPolicyChange={(policy) => updateInspectionPolicy.mutate(policy)}
            isUpdatingInspectionPolicy={updateInspectionPolicy.isPending}
          />
        )}
      </div>
    </Modal>
  );
}
