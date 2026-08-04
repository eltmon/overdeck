/**
 * Would writing an artifact verdict be rejected for disagreeing with the row's
 * anchor? True only when both heads are present and differ. Missing head
 * evidence cannot trip the guard.
 */
export function restoreWouldTripHeadGuard(input: {
  artifactHead?: string | undefined;
  rowHead?: string | undefined;
}): boolean {
  const artifactHead = input.artifactHead;
  const rowHead = input.rowHead;
  if (typeof artifactHead !== 'string' || artifactHead.length === 0) return false;
  if (typeof rowHead !== 'string' || rowHead.length === 0) return false;
  return artifactHead !== rowHead;
}
