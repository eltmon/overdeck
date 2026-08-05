export interface FeedbackAgentState {
  id: string;
  issueId: string;
  role: string;
}

export interface ActiveReviewArtifactContext {
  runId: string;
  workspacePath?: string;
}

type FeedbackAgentStateReader = () => FeedbackAgentState[];
type ActiveReviewArtifactContextReader = (issueId: string) => ActiveReviewArtifactContext | null;

let reader: FeedbackAgentStateReader | null = null;
let activeReviewArtifactContextReader: ActiveReviewArtifactContextReader | null = null;

export function registerFeedbackAgentStateReader(fn: FeedbackAgentStateReader): void {
  reader = fn;
}

export function registerActiveReviewArtifactContextReader(
  fn: ActiveReviewArtifactContextReader,
): void {
  activeReviewArtifactContextReader = fn;
}

export function readFeedbackAgentStates(): FeedbackAgentState[] | null {
  if (!reader) return null;
  try {
    return reader();
  } catch {
    return null;
  }
}

export function readActiveReviewArtifactContext(
  issueId: string,
): ActiveReviewArtifactContext | null {
  if (!activeReviewArtifactContextReader) return null;
  try {
    return activeReviewArtifactContextReader(issueId);
  } catch {
    return null;
  }
}
