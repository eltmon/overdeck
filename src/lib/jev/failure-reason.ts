/**
 * The closed set of reasons a real Jev request can fail (PAN-4369). Its own leaf module so
 * `usage-log.ts` can import the type without creating an import cycle with `client.ts`, which
 * imports `usage-log.ts` for `appendJevUsage`.
 */
export type JevFailureReason =
  | 'auth-failed'
  | 'rate-limited'
  | 'timeout'
  | 'aborted'
  | 'connection-error'
  | 'bad-request'
  | 'server-error'
  | 'error';
