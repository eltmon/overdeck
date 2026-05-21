import { isPendingReviewStranded } from './pipeline-state';

export function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function isStale(isoString: string, thresholdMinutes = 30): boolean {
  return Date.now() - new Date(isoString).getTime() > thresholdMinutes * 60 * 1000;
}

export interface ReviewButtonState {
  label: string;
  disabled: boolean;
  spinning: boolean;
}

interface ReviewButtonInput {
  reviewStatus: 'pending' | 'reviewing' | 'passed' | 'failed' | 'blocked';
  testStatus: 'pending' | 'testing' | 'passed' | 'failed' | 'skipped' | 'dispatch_failed';
  mergeStatus?: 'pending' | 'queued' | 'merging' | 'verifying' | 'merged' | 'failed';
  verificationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  updatedAt?: string;
  reviewSpawnedAt?: string;
  queuePosition?: number | null;
  activeSpecialist?: string | null;
  readyForMerge: boolean;
}

export function shouldForceReviewTrigger(status: ReviewButtonInput | undefined): boolean {
  if (!status) return false;

  return (
    isPendingReviewStranded(status) ||
    status.readyForMerge ||
    status.reviewStatus === 'passed' ||
    status.reviewStatus === 'failed' ||
    status.reviewStatus === 'blocked' ||
    status.testStatus === 'passed' ||
    status.testStatus === 'failed' ||
    status.testStatus === 'dispatch_failed' ||
    status.mergeStatus === 'failed' ||
    status.verificationStatus === 'failed'
  );
}

function getOrdinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

export function getReviewButtonState(
  status: ReviewButtonInput | undefined,
  mutationPending: boolean
): ReviewButtonState {
  if (mutationPending) {
    return { label: 'Review & Test', disabled: true, spinning: true };
  }
  if (!status) {
    return { label: 'Review & Test', disabled: false, spinning: false };
  }
  if (status.reviewStatus === 'reviewing' || (status.queuePosition === 0 && status.activeSpecialist === 'review')) {
    return { label: 'Reviewing...', disabled: true, spinning: true };
  }
  if (status.testStatus === 'testing' || (status.queuePosition === 0 && status.activeSpecialist === 'test')) {
    return { label: 'Testing...', disabled: true, spinning: true };
  }
  if (status.queuePosition != null && status.queuePosition >= 1) {
    if (status.queuePosition === 1) {
      return { label: 'Queued', disabled: true, spinning: false };
    }
    const n = status.queuePosition;
    return { label: `Queued (${n}${getOrdinalSuffix(n)})`, disabled: true, spinning: false };
  }
  if (isPendingReviewStranded(status)) {
    return { label: 'Re-request Review', disabled: false, spinning: false };
  }
  if (status.readyForMerge || (status.reviewStatus === 'passed' && status.testStatus === 'passed' && status.mergeStatus === 'failed')) {
    return { label: 'Re-Review', disabled: false, spinning: false };
  }
  return { label: 'Review & Test', disabled: false, spinning: false };
}

export function getFriendlyModelName(fullModel: string | undefined | null): string {
  if (!fullModel) return 'Unknown';

  // Normalize legacy provider-prefixed models without surfacing a routing badge.
  const backingModel = fullModel.replace(/^(?:oai|cx|go)@/, '');

  // Anthropic models
  if (backingModel.includes('opus-4-6') || backingModel.includes('opus-4.6')) return 'Opus 4.6';
  if (backingModel.includes('opus-4-5') || backingModel.includes('opus-4.5')) return 'Opus 4.5';
  if (backingModel.includes('opus-4-1')) return 'Opus 4.1';
  if (backingModel.includes('opus-4') || backingModel.includes('opus')) return 'Opus 4';
  if (backingModel.includes('sonnet-4-6') || backingModel.includes('sonnet-4.6')) return 'Sonnet 4.6';
  if (backingModel.includes('sonnet-4-5') || backingModel.includes('sonnet-4.5')) return 'Sonnet 4.5';
  if (backingModel.includes('sonnet-4') || backingModel.includes('sonnet')) return 'Sonnet 4';
  if (backingModel.includes('haiku-4-5') || backingModel.includes('haiku-4.5')) return 'Haiku 4.5';
  if (backingModel.includes('haiku-3')) return 'Haiku 3';
  if (backingModel.includes('haiku')) return 'Haiku 4.5';

  // OpenAI models (supported catalog — PAN-1122)
  if (backingModel.includes('gpt-5.5-pro')) return 'GPT-5.5 Pro';
  if (backingModel.includes('gpt-5.5')) return 'GPT-5.5';
  if (backingModel.includes('gpt-5.4-nano')) return 'GPT-5.4 Nano';
  if (backingModel.includes('gpt-5.4-mini')) return 'GPT-5.4 Mini';
  if (backingModel.includes('gpt-5.4')) return 'GPT-5.4';
  if (backingModel.includes('gpt-5')) return 'GPT-5';
  if (backingModel.includes('gpt-4')) return 'GPT-4';
  if (backingModel.includes('gpt-3')) return 'GPT-3';

  // Google models
  if (backingModel.includes('gemini-3.1-pro-preview') || backingModel.includes('gemini-3.1-pro')) return 'Gemini 3.1 Pro';
  if (backingModel.includes('gemini-3-flash')) return 'Gemini 3 Flash';
  if (backingModel.includes('gemini-3')) return 'Gemini 3';
  if (backingModel.includes('gemini-2.5')) return 'Gemini 2.5';
  if (backingModel.includes('gemini')) return 'Gemini';

  return fullModel;
}
