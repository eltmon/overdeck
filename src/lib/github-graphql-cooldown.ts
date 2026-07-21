const GRAPHQL_COOLDOWN_MS = 60_000;

let cooldownStartedAt: number | null = null;

function messageFromError(err: unknown): string {
  if (err instanceof Error) {
    const extra = 'stderr' in err && typeof err.stderr === 'string' ? ` ${err.stderr}` : '';
    return `${err.message}${extra}`;
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isGraphQLRateLimitError(err: unknown): boolean {
  const message = messageFromError(err);
  return /GraphQL:.*rate limit/i.test(message)
    || /rate limit already exceeded/i.test(message)
    || /API rate limit/i.test(message);
}

export function noteGraphQLRateLimit(err: unknown): void {
  if (!isGraphQLRateLimitError(err)) return;
  cooldownStartedAt = Date.now();
}

export function isInGraphQLCooldown(): boolean {
  if (cooldownStartedAt == null) return false;
  return Date.now() - cooldownStartedAt < GRAPHQL_COOLDOWN_MS;
}
