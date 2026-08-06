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

export type DurableReviewDispatcher = DurableReviewPipelineInput['dispatchReview'];
export type DurableReviewPipelineHostInput = Omit<DurableReviewPipelineInput, 'dispatchReview'>;

let handler: DurableReviewPipelineHandler | null = null;
let dispatcher: DurableReviewDispatcher | null = null;

export function registerDurableReviewPipelineHandler(
  nextHandler: DurableReviewPipelineHandler,
): void {
  handler = nextHandler;
}

/** Registers the dashboard-owned review role dispatcher without coupling status reads to a role module. */
export function registerDurableReviewDispatcher(
  nextDispatcher: DurableReviewDispatcher,
): void {
  dispatcher = nextDispatcher;
}

export function hasDurableReviewPipelineHandler(): boolean {
  return handler !== null;
}

export function hasDurableReviewPipelineDispatch(): boolean {
  return handler !== null && dispatcher !== null;
}

/** Re-enters the dashboard-owned verification → push → review path with its registered dispatcher. */
export async function startRegisteredDurableReviewPipelineHostSide(
  input: DurableReviewPipelineHostInput,
): Promise<boolean> {
  return handler && dispatcher ? handler({ ...input, dispatchReview: dispatcher }) : false;
}

/** Runs a supplied pipeline input, primarily for explicitly composed callers and tests. */
export async function startDurableReviewPipelineHostSide(
  input: DurableReviewPipelineInput,
): Promise<boolean> {
  return handler ? handler(input) : false;
}
