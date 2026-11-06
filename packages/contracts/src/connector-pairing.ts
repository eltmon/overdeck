// The Overdeck connector pair string (PAN-4927 W-CONN1, D-17): the text "Connect a bot" shows
// and `pan mcp connector pair` (W-CONN2) parses. Same fields as the phone link (phone-pairing.ts).
import { PHONE_PAIR_CODE_RE, PHONE_PAIR_ENVIRONMENT_ID_RE, PHONE_PAIR_MACHINE_KEY_RE } from "./phone-pairing"

export const CONNECTOR_PAIR_SCHEME = "overdeck-connector"
export const CONNECTOR_PAIR_LINK_VERSION = 1
/** Everything before the fragment. Single slash after the colon. */
export const CONNECTOR_PAIR_LINK_PREFIX = `${CONNECTOR_PAIR_SCHEME}:/pair#`
/** Longest machine name (after trim) the string carries in `n=` (PAN-5069 FR-8). */
export const CONNECTOR_PAIR_MACHINE_LABEL_MAX = 64

export interface ConnectorPairLinkInput {
  environmentId: string
  machineKeyHex: string
  code: string
  /** FR-8: the machine's name, for display only. Optional; never an authority. */
  machineLabel?: string
}

/**
 * `overdeck-connector:/pair#v=1&e=<environmentId>&k=<machineKeyHex>&c=<code>[&n=<machineLabel>]`; throws on a malformed input.
 * The label is trimmed, cut to 64 characters and percent-encoded with `'` as `%27`, so the string is safe inside single shell quotes.
 */
export function buildConnectorPairLink(input: ConnectorPairLinkInput): string {
  if (!PHONE_PAIR_ENVIRONMENT_ID_RE.test(input.environmentId)) throw new Error("environmentId must be a lowercase UUID v4")
  if (!PHONE_PAIR_MACHINE_KEY_RE.test(input.machineKeyHex)) throw new Error("machineKeyHex must be 64 lowercase hex characters")
  if (!PHONE_PAIR_CODE_RE.test(input.code)) throw new Error("code must be an odp_ pairing code")
  const link = `${CONNECTOR_PAIR_LINK_PREFIX}v=${CONNECTOR_PAIR_LINK_VERSION}&e=${input.environmentId}&k=${input.machineKeyHex}&c=${input.code}`
  const label = input.machineLabel?.trim().slice(0, CONNECTOR_PAIR_MACHINE_LABEL_MAX) ?? ""
  return label === "" ? link : `${link}&n=${encodeURIComponent(label).replace(/'/g, "%27")}`
}

/**
 * The inverse of `buildConnectorPairLink`: the string's fields, or null unless every required part is well formed.
 * Surrounding whitespace is ignored. A missing, empty or over-long `n` only leaves `machineLabel` out; it never makes the parse fail.
 */
export function parseConnectorPairLink(text: string): ConnectorPairLinkInput | null {
  const link = text.trim()
  if (!link.startsWith(CONNECTOR_PAIR_LINK_PREFIX)) return null
  const params = new URLSearchParams(link.slice(CONNECTOR_PAIR_LINK_PREFIX.length))
  const environmentId = params.get("e")
  const machineKeyHex = params.get("k")
  const code = params.get("c")
  if (params.get("v") !== String(CONNECTOR_PAIR_LINK_VERSION)) return null
  if (environmentId === null || !PHONE_PAIR_ENVIRONMENT_ID_RE.test(environmentId)) return null
  if (machineKeyHex === null || !PHONE_PAIR_MACHINE_KEY_RE.test(machineKeyHex)) return null
  if (code === null || !PHONE_PAIR_CODE_RE.test(code)) return null
  const machineLabel = params.get("n")?.trim() ?? ""
  if (machineLabel === "" || machineLabel.length > CONNECTOR_PAIR_MACHINE_LABEL_MAX) return { environmentId, machineKeyHex, code }
  return { environmentId, machineKeyHex, code, machineLabel }
}
