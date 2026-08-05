/** Marker written as the first line of a host-authorized review verdict artifact. */
export function reviewArtifactCapabilityMarker(capability: string): string {
  return `<!-- overdeck-review-capability:${capability} -->`;
}
