let intervalId: ReturnType<typeof setInterval> | null = null;

export function startTtsSummarizer(): void {
  if (intervalId !== null) return;
}

export function stopTtsSummarizer(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
