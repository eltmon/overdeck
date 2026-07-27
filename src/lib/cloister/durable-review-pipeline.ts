type SetReviewPending = (update: {
  reviewStatus: 'pending';
  reviewNotes?: string;
}) => void;

export interface DurableReviewDispatchContext {
  issueId: string;
  workspace: string;
  branch: string;
  prUrl?: string;
}

export interface DurableReviewDispatchResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface DurableReviewPipelineInput {
  issueId: string;
  prUrl?: string;
  setReviewPending: SetReviewPending;
  dispatchReview: (
    context: DurableReviewDispatchContext,
  ) => Promise<DurableReviewDispatchResult>;
}

export type DurableReviewPipelineHandler = (
  input: DurableReviewPipelineInput,
) => Promise<boolean>;

let handler: DurableReviewPipelineHandler | null = null;

export function registerDurableReviewPipelineHandler(
  nextHandler: DurableReviewPipelineHandler,
): void {
  handler = nextHandler;
}

export function hasDurableReviewPipelineHandler(): boolean {
  return handler !== null;
}

/** Re-enters the dashboard-owned verification → push → review path. */
export async function startDurableReviewPipelineHostSide(
  input: DurableReviewPipelineInput,
): Promise<boolean> {
  return handler ? handler(input) : false;
}
