export interface FeedbackAgentState {
  id: string;
  issueId: string;
  role: string;
}

type FeedbackAgentStateReader = () => FeedbackAgentState[];

let reader: FeedbackAgentStateReader | null = null;

export function registerFeedbackAgentStateReader(fn: FeedbackAgentStateReader): void {
  reader = fn;
}

export function readFeedbackAgentStates(): FeedbackAgentState[] | null {
  if (!reader) return null;
  try {
    return reader();
  } catch {
    return null;
  }
}
