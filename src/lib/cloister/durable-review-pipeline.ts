type SetReviewPending = (update: {
  // PAN-3674: 'failed' allowed so a dispatch failure is recorded as failed —
  // forcing 'pending' there overwrote the dispatcher's own failure write and
  // stranded the issue in a state no gate or sweep understands (PAN-3668).
  reviewStatus: 'pending' | 'failed';
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

/**
 * PAN-3674: run ONLY the registered review dispatcher (no verification re-run).
 * The repair path for post-verification dispatch failures — verification already
 * passed at this HEAD, so re-running the full gate suite per retry is waste.
 * Returns null when no dispatcher is registered (non-server processes).
 */
export async function dispatchRegisteredReviewHostSide(
  context: DurableReviewDispatchContext,
): Promise<DurableReviewDispatchResult | null> {
  return dispatcher ? dispatcher(context) : null;
}

/** Runs a supplied pipeline input, primarily for explicitly composed callers and tests. */
export async function startDurableReviewPipelineHostSide(
  input: DurableReviewPipelineInput,
): Promise<boolean> {
  return handler ? handler(input) : false;
}
