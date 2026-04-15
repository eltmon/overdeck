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
  reviewStatus: string;
  testStatus: string;
  mergeStatus?: string;
  verificationStatus?: string;
  queuePosition?: number | null;
  activeSpecialist?: string | null;
  readyForMerge: boolean;
}

export function shouldForceReviewTrigger(status: ReviewButtonInput | undefined): boolean {
  if (!status) return false;

  return (
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
  if (status.readyForMerge || (status.reviewStatus === 'passed' && status.testStatus === 'passed' && status.mergeStatus === 'failed')) {
    return { label: 'Re-Review', disabled: false, spinning: false };
  }
  return { label: 'Review & Test', disabled: false, spinning: false };
}

export function getFriendlyModelName(fullModel: string | undefined | null): string {
  if (!fullModel) return 'Unknown';

  // Handle claudish-prefixed models: oai@gpt-5.4, cx@o3, go@gemini-3.1-pro-preview
  const prefixMatch = fullModel.match(/^((?:oai|cx|go)@)/);
  const prefix = prefixMatch ? prefixMatch[1] : null;
  const backingModel = prefix ? fullModel.slice(prefix.length) : fullModel;

  // Anthropic models
  if (backingModel.includes('opus-4-6') || backingModel.includes('opus-4.6')) return prefix ? `Opus 4.6 (${prefix})` : 'Opus 4.6';
  if (backingModel.includes('opus-4-5') || backingModel.includes('opus-4.5')) return prefix ? `Opus 4.5 (${prefix})` : 'Opus 4.5';
  if (backingModel.includes('opus-4-1')) return prefix ? `Opus 4.1 (${prefix})` : 'Opus 4.1';
  if (backingModel.includes('opus-4') || backingModel.includes('opus')) return prefix ? `Opus 4 (${prefix})` : 'Opus 4';
  if (backingModel.includes('sonnet-4-6') || backingModel.includes('sonnet-4.6')) return prefix ? `Sonnet 4.6 (${prefix})` : 'Sonnet 4.6';
  if (backingModel.includes('sonnet-4-5') || backingModel.includes('sonnet-4.5')) return prefix ? `Sonnet 4.5 (${prefix})` : 'Sonnet 4.5';
  if (backingModel.includes('sonnet-4') || backingModel.includes('sonnet')) return prefix ? `Sonnet 4 (${prefix})` : 'Sonnet 4';
  if (backingModel.includes('haiku-4-5') || backingModel.includes('haiku-4.5')) return prefix ? `Haiku 4.5 (${prefix})` : 'Haiku 4.5';
  if (backingModel.includes('haiku-3')) return prefix ? `Haiku 3 (${prefix})` : 'Haiku 3';
  if (backingModel.includes('haiku')) return prefix ? `Haiku 4.5 (${prefix})` : 'Haiku 4.5';

  // OpenAI models
  if (backingModel.includes('gpt-5.4-pro')) return prefix ? `GPT-5.4 Pro (${prefix})` : 'GPT-5.4 Pro';
  if (backingModel.includes('gpt-5.4-mini')) return prefix ? `GPT-5.4 Mini (${prefix})` : 'GPT-5.4 Mini';
  if (backingModel.includes('gpt-5.4-nano')) return prefix ? `GPT-5.4 Nano (${prefix})` : 'GPT-5.4 Nano';
  if (backingModel.includes('gpt-5.4')) return prefix ? `GPT-5.4 (${prefix})` : 'GPT-5.4';
  if (backingModel.includes('gpt-5.3')) return prefix ? `GPT-5.3 (${prefix})` : 'GPT-5.3';
  if (backingModel.includes('gpt-5.2')) return prefix ? `GPT-5.2 (${prefix})` : 'GPT-5.2';
  if (backingModel.includes('gpt-5.1')) return prefix ? `GPT-5.1 (${prefix})` : 'GPT-5.1';
  if (backingModel.includes('gpt-5')) return prefix ? `GPT-5 (${prefix})` : 'GPT-5';
  if (backingModel.includes('gpt-4o')) return prefix ? `GPT-4o (${prefix})` : 'GPT-4o';
  if (backingModel.includes('gpt-4')) return prefix ? `GPT-4 (${prefix})` : 'GPT-4';
  if (backingModel.includes('gpt-3')) return prefix ? `GPT-3 (${prefix})` : 'GPT-3';
  if (backingModel.includes('o4-mini') || backingModel === 'o4-mini') return prefix ? `O4 Mini (${prefix})` : 'O4 Mini';
  if (backingModel.includes('o3-mini')) return prefix ? `O3 Mini (${prefix})` : 'O3 Mini';
  if (backingModel.includes('o3')) return prefix ? `O3 (${prefix})` : 'O3';
  if (backingModel.includes('o1')) return prefix ? `O1 (${prefix})` : 'O1';

  // Google models
  if (backingModel.includes('gemini-3.1-pro-preview') || backingModel.includes('gemini-3.1-pro')) return prefix ? `Gemini 3.1 Pro (${prefix})` : 'Gemini 3.1 Pro';
  if (backingModel.includes('gemini-3-flash')) return prefix ? `Gemini 3 Flash (${prefix})` : 'Gemini 3 Flash';
  if (backingModel.includes('gemini-3')) return prefix ? `Gemini 3 (${prefix})` : 'Gemini 3';
  if (backingModel.includes('gemini-2.5')) return prefix ? `Gemini 2.5 (${prefix})` : 'Gemini 2.5';
  if (backingModel.includes('gemini')) return prefix ? `Gemini (${prefix})` : 'Gemini';

  return fullModel;
}
