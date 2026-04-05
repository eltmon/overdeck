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
  queuePosition?: number | null;
  activeSpecialist?: string | null;
  readyForMerge: boolean;
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
  if (status.readyForMerge) {
    return { label: 'Re-Review', disabled: false, spinning: false };
  }
  return { label: 'Review & Test', disabled: false, spinning: false };
}

export function getFriendlyModelName(fullModel: string | undefined | null): string {
  if (!fullModel) return 'Unknown';
  if (fullModel.includes('opus-4-6') || fullModel.includes('opus-4.6')) return 'Opus 4.6';
  if (fullModel.includes('opus-4-5') || fullModel.includes('opus-4.5')) return 'Opus 4.5';
  if (fullModel.includes('opus-4-1')) return 'Opus 4.1';
  if (fullModel.includes('opus-4') || fullModel.includes('opus')) return 'Opus 4';
  if (fullModel.includes('sonnet-4-6') || fullModel.includes('sonnet-4.6')) return 'Sonnet 4.6';
  if (fullModel.includes('sonnet-4-5') || fullModel.includes('sonnet-4.5')) return 'Sonnet 4.5';
  if (fullModel.includes('sonnet-4') || fullModel.includes('sonnet')) return 'Sonnet 4';
  if (fullModel.includes('haiku-4-5') || fullModel.includes('haiku-4.5')) return 'Haiku 4.5';
  if (fullModel.includes('haiku-3')) return 'Haiku 3';
  if (fullModel.includes('haiku')) return 'Haiku 4.5';
  return fullModel;
}
