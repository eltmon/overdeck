import { X, ScrollText } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { VBriefViewer } from './VBriefViewer';
import type { VBriefDocument, VBriefInspectionPolicy } from './types';

interface VBriefDialogProps {
  issueId: string;
  onClose: () => void;
}

export function VBriefDialog({ issueId, onClose }: VBriefDialogProps) {
  const queryClient = useQueryClient();
  const queryKey = ['vbrief-plan', issueId];
  const { data: doc, isLoading, isError } = useQuery<VBriefDocument | null>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/plan`);
      if (!res.ok) return null;
      return res.json() as Promise<VBriefDocument>;
    },
    retry: false,
  });
  const updateInspectionPolicy = useMutation({
    mutationFn: async (inspectionPolicy: VBriefInspectionPolicy) => {
      const res = await fetch(`/api/workspaces/${issueId}/plan/inspection-policy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionPolicy }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res.json() as Promise<VBriefDocument>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, updated);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-signal-review" />
            <h2 className="font-semibold text-foreground">vBRIEF Plan: {issueId}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-card rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
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
            <VBriefViewer
              doc={doc ?? null}
              onInspectionPolicyChange={(policy) => updateInspectionPolicy.mutate(policy)}
              isUpdatingInspectionPolicy={updateInspectionPolicy.isPending}
            />
          )}
        </div>
      </div>
    </div>
  );
}
