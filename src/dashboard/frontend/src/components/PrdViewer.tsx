import { useQuery } from '@tanstack/react-query';
import { ChatMarkdown } from './chat/ChatMarkdown';
import { Modal } from './shared/Modal';
import formStyles from './shared/ModalForm.module.css';

interface PrdResponse {
  hasPrd: true;
  content: string;
  path: string;
  status: string;
  format: string;
}

interface PrdViewerProps {
  issueId: string;
  onClose: () => void;
}

export function useIssuePrdQuery(issueId: string) {
  return useQuery<PrdResponse | null>({
    queryKey: ['issue-prd', issueId],
    queryFn: async () => {
      const response = await fetch(`/api/issues/${issueId}/prd`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Failed to fetch PRD: HTTP ${response.status}`);
      return response.json() as Promise<PrdResponse>;
    },
    retry: false,
  });
}

/** The PRD's states and content, without a dialog (PAN-5253: the Plan tab's PRD view). */
export function PrdBody({ issueId }: { issueId: string }) {
  const { data, isLoading, isError } = useIssuePrdQuery(issueId);
  return (
    <>
      {isLoading && (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          Loading PRD...
        </div>
      )}
      {isError && (
        <div className="flex items-center justify-center h-full text-sm text-destructive">
          Failed to load PRD.
        </div>
      )}
      {!isLoading && !isError && !data && (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          No PRD draft for this issue.
        </div>
      )}
      {data && <ChatMarkdown text={data.content} issueId={issueId} />}
    </>
  );
}

export function PrdViewer({ issueId, onClose }: PrdViewerProps) {
  const { data } = useIssuePrdQuery(issueId);

  return (
    <Modal
      title={`PRD: ${issueId}`}
      description={data?.path}
      size="xl"
      closeLabel="Close PRD viewer"
      onClose={onClose}
    >
      <div className={formStyles.content}>
        <PrdBody issueId={issueId} />
      </div>
    </Modal>
  );
}
