// The Overdeck connector pair string (PAN-4927 W-CONN1, D-17): the text "Connect a bot" shows
// and `pan mcp connector pair` (W-CONN2) parses. Same fields as the phone link (phone-pairing.ts).
import { PHONE_PAIR_CODE_RE, PHONE_PAIR_ENVIRONMENT_ID_RE, PHONE_PAIR_MACHINE_KEY_RE } from "./phone-pairing"

export const CONNECTOR_PAIR_SCHEME = "overdeck-connector"
export const CONNECTOR_PAIR_LINK_VERSION = 1
/** Everything before the fragment. Single slash after the colon. */
export const CONNECTOR_PAIR_LINK_PREFIX = `${CONNECTOR_PAIR_SCHEME}:/pair#`

export interface ConnectorPairLinkInput {
  environmentId: string
  machineKeyHex: string
  code: string
}

/** `overdeck-connector:/pair#v=1&e=<environmentId>&k=<machineKeyHex>&c=<code>`; throws on a malformed input. */
export function buildConnectorPairLink(input: ConnectorPairLinkInput): string {
  if (!PHONE_PAIR_ENVIRONMENT_ID_RE.test(input.environmentId)) throw new Error("environmentId must be a lowercase UUID v4")
  if (!PHONE_PAIR_MACHINE_KEY_RE.test(input.machineKeyHex)) throw new Error("machineKeyHex must be 64 lowercase hex characters")
  if (!PHONE_PAIR_CODE_RE.test(input.code)) throw new Error("code must be an odp_ pairing code")
  return `${CONNECTOR_PAIR_LINK_PREFIX}v=${CONNECTOR_PAIR_LINK_VERSION}&e=${input.environmentId}&k=${input.machineKeyHex}&c=${input.code}`
}

/** The inverse of `buildConnectorPairLink`: the string's fields, or null unless every part is well formed. Surrounding whitespace is ignored. */
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
  return { environmentId, machineKeyHex, code }
}
