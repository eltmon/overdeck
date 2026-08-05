import { REVIEW_ATTESTATION_KEY_ENV } from './review-attestation-key.js';
import { shellQuote } from './shell-quote.js';

const BOUNDARY_ENV = 'OVERDECK_AGENT_HOST_SECRET_BOUNDARY';

/**
 * Re-exec a local coding-agent launcher inside a filesystem boundary that masks
 * the dashboard's review-attestation signing key. The launcher fails closed when
 * its platform cannot provide the boundary; silently running unconfined would
 * hand same-UID workspace code the host signing authority.
 */
export function buildAgentHostSecretBoundaryPrelude(
  platform: NodeJS.Platform = process.platform,
  keyPath?: string,
): string[] {
  const keyVariable = '_overdeck_review_attestation_key';
  const keyReference = `"$${keyVariable}"`;
  const keyAssignment = keyPath
    ? `${keyVariable}=${shellQuote(keyPath)}`
    : `${keyVariable}="\${OVERDECK_HOME:-$HOME/.overdeck}/review-attestation-key"`;
  const error = 'review attestation isolation is unavailable; refusing to start coding agent';

  const lines = [
    keyAssignment,
    `unset ${REVIEW_ATTESTATION_KEY_ENV}`,
    `if [[ -e ${keyReference} && "\${${BOUNDARY_ENV}:-}" != "1" ]]; then`,
  ];

  if (platform === 'linux') {
    lines.push(
      `  command -v bwrap >/dev/null 2>&1 || { echo ${shellQuote(`${error}: bubblewrap (bwrap) is required`)} >&2; exit 78; }`,
      `  exec bwrap --bind / / --dev-bind /dev /dev --unshare-pid --proc /proc --unshare-ipc --new-session --bind /dev/null ${keyReference} --setenv ${BOUNDARY_ENV} 1 -- "$0" "$@"`,
    );
  } else if (platform === 'darwin') {
    lines.push(
      `  command -v sandbox-exec >/dev/null 2>&1 || { echo ${shellQuote(`${error}: sandbox-exec is required`)} >&2; exit 78; }`,
      `  _overdeck_sandbox_profile='(version 1)(allow default)(deny file-read-data file-write* (literal "'"$${keyVariable}"'"))'`,
      `  exec sandbox-exec -p "$_overdeck_sandbox_profile" env ${BOUNDARY_ENV}=1 "$0" "$@"`,
    );
  } else {
    lines.push(`  echo ${shellQuote(`${error}: unsupported platform ${platform}`)} >&2`, '  exit 78');
  }

  lines.push('fi');
  return lines;
}
